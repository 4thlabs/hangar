import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";
import { logger } from "#libs/logs";
import { AppFileSyntax } from "./app-file-syntax.ts";
import { HangarConfig } from "./hangar-config.ts";
import { HangarEnv } from "./hangar-env.ts";
import { HangarError, HangarRuntimeError, NotFoundError } from "./hangar-error.ts";
import { Runtime, type CommandRunner, type RunOptions } from "./runtime/runtime.ts";

export type HangarApp = {
  id: string;
  name: string;
  icon: string | undefined;
  installed: boolean;
  /** The container the app's own service declares, which Traefik routes `<container>.<DOMAIN>` to. */
  containerName: string;
};

/** The app store on disk: its stacks, the installed links, and the compose commands over them. */
export class HangarStore {
  /** Run order per compose command: 1 in stack order, -1 in reverse, absent means parallel */
  static readonly CommandOrder: Record<string, number> = { up: 1, start: 1, restart: 1, down: -1, stop: -1 };

  /** Commands that address the whole store instead of a single stack */
  static readonly GlobalCommand = ["up", "down", "pull"];

  /** A stack id is a folder name under `store/` (`llama.cpp`): no separator, no leading dot, nothing to climb out with */
  private static readonly StackId = /^[a-z0-9][a-z0-9._-]*$/;

  /** The file that makes a folder under `store/` an app, validated by `docker compose config` */
  private static readonly ComposeFile = "compose.yml";

  /** How much of a file is read to tell text from binary, as much as git reads */
  private static readonly BinarySniffLength = 8000;

  readonly dataPath: string;

  /** One symlink per installed app, next to the shared files. */
  readonly installedPath: string;

  /** The clone of the store repository. */
  readonly storePath: string;

  readonly url: string;

  /** Configuration shipped by the store, empty until the store is on disk */
  readonly config: HangarConfig;

  /** The global environment every stack is composed with */
  readonly env: HangarEnv;

  private readonly runtime: CommandRunner;

  /** Every app the store carries, installed or not. */
  apps: Set<HangarApp> = new Set();

  /**
   * @param url The store repository to clone
   * @param dataDir Where the store, the installed links and the app data live
   */
  constructor(url: string, dataDir: string, runtime: CommandRunner) {
    this.url = url;
    this.dataPath = path.resolve(dataDir);
    this.storePath = path.join(this.dataPath, "app-store");
    this.installedPath = path.join(this.dataPath, "app-installed");
    this.config = new HangarConfig(path.join(this.storePath, "config", "hangar.yml"));
    // APP_DATA_DIR is the one variable Hangar can answer for the operator: the stacks keep
    // their data under the same resolved data directory Hangar itself uses.
    this.env = new HangarEnv(this.dataPath, this.installedPath, { APP_DATA_DIR: path.join(this.dataPath, "app-data") });
    this.runtime = runtime;
  }

  /**
   * Resolve a name to the stacks it covers: no name covers every category,
   * a category its own stacks, anything else is taken as a stack name.
   * @param name A global command, a category or a stack name
   */
  resolve(name: string = "") {
    // prettier-ignore
    const stacks = [...new Set(
        this.config.categories()
            .filter(c => name.length == 0 || c.name === name)
            .flatMap(c => c.stacks)
    )];

    return stacks.length > 0 ? stacks : [name];
  }

  /**
   * Links(symlink) a stack into the installed apps.
   * @param name the stack name
   */
  async link(name: string) {
    const source = path.join(this.storePath, "store", name);
    const destination = path.join(this.installedPath, name);

    if ((await Runtime.exists(source)) && !(await Runtime.exists(destination))) {
      logger.info(`Linking application: ${name}`);
      await symlink(source, destination, "dir");
    }
  }

  /**
   * Removes a stack's symlink from the installed apps, leaving the stack itself in the store.
   * @param name the stack name
   */
  async unlink(name: string) {
    const destination = path.join(this.installedPath, name);

    if (await Runtime.exists(destination)) {
      logger.info(`Unlinking application: ${name}`);
      await unlink(destination);
    }
  }

  /** Links every stack the config lists, and the shared files (networks, common env) next to them. */
  private async linkAll() {
    const entries = [...this.resolve(), ...this.config.shared()];

    // prettier-ignore
    await Promise.all(
      entries
        .map(async entry => await this.link(entry)
        .catch(ex => logger.error(`Failed to link: ${entry}`, { error: ex }))),
    );
  }

  /**
   * Writes hangar.yml, then links what it now lists and reloads the apps.
   * @param source The YAML; an invalid one throws and leaves the file untouched
   */
  async saveConfig(source: string) {
    await this.config.write(source);
    await this.linkAll();
    await this.refresh();
  }

  /** Whether the store repository has been cloned. */
  async isInstalled() {
    return Runtime.exists(path.join(this.storePath, ".git"));
  }

  /**
   * Installs the store by cloning its repository, or updates it with a fast-forward pull when it
   * is already there.
   */
  async install() {
    if (!(await Runtime.exists(this.installedPath))) {
      await mkdir(this.installedPath, { recursive: true });
    }

    if (await this.isInstalled()) {
      await this.runtime.run("git", ["-C", this.storePath, "pull", "--ff-only"]);
    } else {
      await this.runtime.run("git", ["clone", "--", this.url, this.storePath]);
    }

    // The categories only exist once the clone brought hangar.yml in.
    await this.config.load();
    await this.linkAll();

    // The stacks are composed with .env.global: without it every compose call fails, so a
    // fresh install leaves the operator the list of variables to fill rather than nothing.
    await this.env.ensure();
  }

  /**
   * Runs docker compose against a single installed stack
   * @param stack The stack name
   * @param args Arguments passed through to docker compose
   * @param options Run options, forwarded to the runtime (`pipe` to capture the output)
   */
  private async composeStack(stack: string, args: string[], options?: RunOptions) {
    const compose = path.join(this.installedPath, stack, "compose.yml");

    if (!(await Runtime.exists(compose))) {
      throw new HangarRuntimeError(1, `Failed to find project: ${stack}`);
    }

    // `-p` pins the project to the stack name: the compose file's `name:` is a display label
    // ("Home Assistant"), and compose would derive the project from it by dropping everything
    // outside [a-z0-9_-] ("homeassistant"), so its containers no longer match the installed app.
    // prettier-ignore
    return this.runtime.run("docker", [
      "compose",
      "--env-file", this.env.file(),
      "-p", stack,
      "-f", compose,
      ...args,
    ], options);
  }

  /**
   * Runs docker compose against every stack, a category or a single stack.
   * @param name A global command, a category or a stack name
   * @param args Arguments passed through to docker compose
   * @param options Run options, forwarded to the runtime (`pipe` to capture the output)
   */
  async compose(name: string, args: string[], options?: RunOptions) {
    // `store up -d` / `store down` / `store pull`: no target, the command takes its place
    if (HangarStore.GlobalCommand.includes(name)) {
      args = [name, ...args];
      name = "";
    }

    const command = args[0] ?? "";
    const stacks = this.resolve(name);

    if (command === "up" && !HangarStore.detached(args) && stacks.length > 1) {
      throw new HangarRuntimeError(1, "Non detached mode only authorised on a single stack");
    }

    const order = HangarStore.CommandOrder[command] ?? 0;

    // Unordered: let every stack run, then surface the first failure.
    if (order === 0) {
      const results = await Promise.allSettled(stacks.map(stack => this.composeStack(stack, args, options)));
      const failure = results.find(result => result.status === "rejected");

      if (failure) {
        throw failure.reason;
      }

      return;
    }

    // Ordered: stop at the first failure, up/start forwards, down/stop backwards.
    for (const stack of order === 1 ? stacks : [...stacks].reverse()) {
      await this.composeStack(stack, args, options);
    }
  }

  /** The store app with this id, or `undefined` when the store does not carry it. */
  app(id: string): HangarApp | undefined {
    for (const app of this.apps) {
      if (app.id === id) {
        return app;
      }
    }

    return undefined;
  }

  /**
   * Adds a new store app once `docker compose config` accepts its compose.yml. A rejected source
   * creates nothing.
   * @param id The app id, its folder under `store/`; must not exist yet
   * @param source The compose YAML
   */
  async createApp(id: string, source: string) {
    const folder = this.appFolder(id);

    if (await Runtime.exists(folder)) {
      throw new HangarError(`The app ${id} already exists`);
    }

    await mkdir(folder, { recursive: true });

    try {
      await this.writeValidatedCompose(folder, source);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * The text files of a store app, as paths relative to its folder (`config/settings.yml`), sorted.
   * Hidden files (`.compose.pending.yml`), binaries and symlinks are left out: none of them is the
   * operator's to edit.
   * @param id The app id, its folder under `store/`; must already exist
   */
  async appFiles(id: string) {
    const folder = await this.existingAppFolder(id);
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });

    const files = entries
      .filter(entry => entry.isFile())
      .map(entry => path.relative(folder, path.join(entry.parentPath, entry.name)))
      .filter(file => !HangarStore.isHidden(file));

    const isText = await Promise.all(files.map(file => HangarStore.isTextFile(path.join(folder, file))));

    return files.filter((_, index) => isText[index]).sort();
  }

  /**
   * One text file of a store app.
   * @param id The app id, its folder under `store/`; must already exist
   * @param relativePath The file's path inside the app folder, as {@link appFiles} lists it
   */
  async appFile(id: string, relativePath: string) {
    const file = await this.appFilePath(id, relativePath);

    if (!(await Runtime.exists(file))) {
      throw new NotFoundError(`The app ${id} has no file ${relativePath}`);
    }

    if (!(await HangarStore.isTextFile(file))) {
      throw new HangarError(`${relativePath} is not a text file`);
    }

    return readFile(file, "utf8");
  }

  /**
   * Writes one file of a store app, creating it and its folders when missing, once its syntax
   * checks out: `docker compose config` for the root compose.yml, a parse for YAML and env files,
   * nothing for the others. A rejected source leaves the file untouched.
   * @param id The app id, its folder under `store/`; must already exist
   * @param relativePath The file's path inside the app folder (`config/settings.yml`)
   * @param source The file's new content
   */
  async writeAppFile(id: string, relativePath: string, source: string) {
    const file = await this.appFilePath(id, relativePath);

    if (relativePath === HangarStore.ComposeFile) {
      await this.writeValidatedCompose(path.dirname(file), source);

      return;
    }

    AppFileSyntax.check(relativePath, source);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, "utf8");
  }

  /** The folder of an app that may be edited, which must already be on disk. */
  private async existingAppFolder(id: string) {
    const folder = this.appFolder(id);

    if (!(await Runtime.exists(folder))) {
      throw new HangarError(`The app ${id} does not exist`);
    }

    return folder;
  }

  /**
   * Where a file of an app lives, once its path is known to stay inside the app folder: no
   * absolute path, no `..`, no hidden segment, and no symlink leading out of the folder.
   */
  private async appFilePath(id: string, relativePath: string) {
    const folder = await this.existingAppFolder(id);
    const segments = relativePath.split("/");

    // A leading dot covers `.` and `..` too, and keeps the files the listing hides out of reach.
    const isMalformed =
      path.isAbsolute(relativePath) || segments.some(segment => segment === "" || segment.startsWith("."));

    if (isMalformed) {
      throw new HangarError(`Invalid file path: ${relativePath}`);
    }

    const file = path.join(folder, ...segments);
    const [realFolder, realFile] = await Promise.all([realpath(folder), HangarStore.realpathOfExisting(file)]);
    const relativeToFolder = path.relative(realFolder, realFile);

    const isOutside =
      relativeToFolder === ".." || relativeToFolder.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToFolder);

    if (isOutside) {
      throw new HangarError(`${relativePath} leads outside the app ${id}`);
    }

    if ((await Runtime.exists(file)) && !(await stat(file)).isFile()) {
      throw new HangarError(`${relativePath} is not a file`);
    }

    return file;
  }

  /** The folder of an app that may be created or edited: not one of the shared files. */
  private appFolder(id: string) {
    const folder = this.stackPath(id);

    if (this.config.shared().includes(id)) {
      throw new HangarError(`${id} is a shared file, not an app`);
    }

    return folder;
  }

  /**
   * Writes `source` as the folder's compose.yml if `docker compose config` accepts it, then
   * reloads the apps. On a rejection only the pending copy is removed.
   */
  private async writeValidatedCompose(folder: string, source: string) {
    // Next to the real file, so the paths it references resolve the same way.
    const pending = path.join(folder, ".compose.pending.yml");

    // No `-p`: compose rejects some folder names as project names (`llama.cpp`), and a
    // validation does not need one.
    try {
      await writeFile(pending, source, "utf8");

      // prettier-ignore
      await this.runtime.run("docker", [
        "compose",
        "--env-file", this.env.file(),
        "-f", pending,
        "config", "-q",
      ], { capture: true });
    } catch (error) {
      await rm(pending, { force: true });
      throw error;
    }

    await rename(pending, path.join(folder, HangarStore.ComposeFile));
    await this.refresh();
  }

  /** The folder of a store app, once its id is known not to escape `store/`. */
  private stackPath(id: string) {
    if (!HangarStore.StackId.test(id)) {
      throw new HangarError(`Invalid app id: ${id}`);
    }

    return path.join(this.storePath, "store", id);
  }

  /** The ids of the installed apps. */
  installedProjectIds(): Set<string> {
    return new Set([...this.apps].flatMap(app => (app.installed ? [app.id] : [])));
  }

  /** Reloads `hangar.yml` and every app's compose file. */
  async refresh() {
    this.apps.clear();

    if (await this.isInstalled()) {
      await this.config.load();

      const shared = this.config.shared();
      const entries = await readdir(path.join(this.storePath, "store"), { recursive: false });
      const apps = entries.filter(entry => !shared.includes(entry));
      const installed = await readdir(this.installedPath, { recursive: false });

      // One malformed app is skipped: a rejection here would fail the server's boot.
      await Promise.all(
        apps.map(async app => {
          try {
            const source = await readFile(path.join(this.storePath, "store", app, "compose.yml"), "utf8");
            const yaml = load(source, { filename: "compose.yml" }) as Record<string, unknown> | undefined;
            const metadata = yaml?.["x-hangar"] as { icon?: string } | undefined;
            const services = (yaml?.["services"] ?? {}) as Record<string, { container_name?: string } | undefined>;

            // The main service is the one named after the app, else the first declared.
            const service = services[app] ?? Object.values(services)[0];

            this.apps.add({
              id: app,
              name: (yaml?.["name"] as string | undefined) ?? HangarStore.capitalize(app),
              icon: metadata?.icon,
              installed: installed.indexOf(app) !== -1,
              containerName: service?.container_name ?? app,
            });
          } catch (error) {
            logger.warn("Skipping store app: its compose.yml could not be read", { error, app });
          }
        }),
      );
    }
  }

  /** Whether a path inside an app folder has a hidden segment (`.compose.pending.yml`, `.cache/x`). */
  private static isHidden(relativePath: string) {
    return relativePath.split(path.sep).some(segment => segment.startsWith("."));
  }

  /** Git's heuristic: a NUL byte in the first few kilobytes makes a file binary. */
  private static async isTextFile(file: string) {
    const handle = await open(file, "r");

    try {
      const head = Buffer.alloc(HangarStore.BinarySniffLength);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);

      return !head.subarray(0, bytesRead).includes(0);
    } finally {
      await handle.close();
    }
  }

  /**
   * The real path of `target`, or of its closest existing ancestor while it does not exist yet. A
   * dangling symlink is refused: writing through it would create its target, wherever it points.
   */
  private static async realpathOfExisting(target: string): Promise<string> {
    try {
      return await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const link = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (link?.isSymbolicLink()) {
      throw new HangarError(`${path.basename(target)} is a broken symlink`);
    }

    return HangarStore.realpathOfExisting(path.dirname(target));
  }

  /** Whether the compose args ask for detached mode. */
  private static detached(args: string[]) {
    return args.includes("-d") || args.includes("--detach");
  }

  private static capitalize(s: string) {
    return s && String(s[0]).toUpperCase() + String(s).slice(1);
  }
}
