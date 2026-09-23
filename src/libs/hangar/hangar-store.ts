import { HangarConfig } from "./hangar-config.ts";
import { HangarEnv } from "./hangar-env.ts";
import { mkdir, readdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";
import { load } from "js-yaml";
import { type CommandRunner, type RunOptions } from "./runtime/runtime.ts";
import { exists } from "./runtime/utils.ts";
import { HangarError, HangarRuntimeError } from "./hangar-error.ts";

/** True when the compose args ask for detached mode */
const detached = (args: string[]) => args.includes("-d") || args.includes("--detach");

/** A stack id is a folder name under `store/` (`llama.cpp`): no separator, no leading dot, nothing to climb out with */
const STACK_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** Capitalize first letter of a string */
const capitalize = (s: string) => s && String(s[0]).toUpperCase() + String(s).slice(1);

export type HangarApp = {
  id: string;
  name: string;
  icon: string | undefined;
  installed: boolean;
  /** The container the app's own service declares, which Traefik routes `<container>.<DOMAIN>` to. */
  containerName: string;
};

/**
 * Representation of the App Store
 */
export class HangarStore {
  /** Run order per compose command: 1 in stack order, -1 in reverse, absent means parallel */
  static readonly CommandOrder: Record<string, number> = { up: 1, start: 1, restart: 1, down: -1, stop: -1 };

  /** Commands that address the whole store instead of a single stack */
  static readonly GlobalCommand = ["up", "down", "pull"];

  /** Path of Hangar sata */
  readonly dataPath: string;

  /** Path where the app are installed */
  readonly installedPath: string;

  /** Path of the store */
  readonly storePath: string;

  /** The URL of the store repository */
  readonly url: string;

  /** Configuration shipped by the store, empty until the store is on disk */
  readonly config: HangarConfig;

  /** The global environment every stack is composed with */
  readonly env: HangarEnv;

  /** Runtime to launch commands */
  private readonly runtime: CommandRunner;

  /** A list of all available App */
  apps: Set<HangarApp> = new Set();

  /**
   * Constructs the App Store
   * @param url URL of the store repository
   * @param dataDir Directory for storing data
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

    if ((await exists(source)) && !(await exists(destination))) {
      logger.info(`Linking application: ${name}`);
      await symlink(source, destination, "dir");
    }
  }

  /**
   * Links(symlink) a stack into the installed apps.
   * @param name the stack name
   */
  async unlink(name: string) {
    const destination = path.join(this.installedPath, name);

    if (await exists(destination)) {
      logger.info(`Unlinking application: ${name}`);
      await unlink(destination);
    }
  }

  /**
   * Returns true if the store is installed, false otherwise
   * @returns boolean indicating if the store is installed
   */
  async isInstalled() {
    return exists(path.join(this.storePath, ".git"));
  }

  /**
   * Install/Updates the store by cloning the repo or updates it
   * @param update boolean Wheter to update the store if already installed
   */
  async install() {
    if (!(await exists(this.installedPath))) {
      await mkdir(this.installedPath, { recursive: true });
    }

    if (await this.isInstalled()) {
      await this.runtime.run("git", ["-C", this.storePath, "pull", "--ff-only"]);
    } else {
      await this.runtime.run("git", ["clone", "--", this.url, this.storePath]);
    }

    // The categories only exist once the clone brought hangar.yml in.
    await this.config.load();

    // The shared files (networks, common env) live next to the stacks and link the same way.
    const entries = [...this.resolve(), ...this.config.shared()];

    // prettier-ignore
    await Promise.all(
      entries
        .map(async entry => await this.link(entry)
        .catch(ex => logger.error(`Failed to link: ${entry}`, { error: ex }))),
    );

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

    if (!(await exists(compose))) {
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

    if (command === "up" && !detached(args) && stacks.length > 1) {
      throw new HangarRuntimeError(1, "Non detached mode only authorised on a single stack");
    }

    const order = HangarStore.CommandOrder[command] ?? 0;

    // Unordered: let every stack run, then surface the first failure.
    if (order === 0) {
      const results = await Promise.allSettled(stacks.map(stack => this.composeStack(stack, args, options)));
      const failure = results.find(result => result.status === "rejected");

      if (failure) throw failure.reason;
      return;
    }

    // Ordered: stop at the first failure, up/start forwards, down/stop backwards.
    for (const stack of order === 1 ? stacks : [...stacks].reverse()) {
      await this.composeStack(stack, args, options);
    }
  }

  /** The store app with this id, or `undefined` when the store does not carry it. */
  app(id: string): HangarApp | undefined {
    for (const app of this.apps) if (app.id === id) return app;
    return undefined;
  }

  /** The raw compose.yml of a store app. */
  async appSource(id: string) {
    return readFile(path.join(this.stackPath(id), "compose.yml"), "utf8");
  }

  /**
   * Writes a store app's compose.yml once `docker compose config` accepts it: a rejected source
   * leaves the app untouched, and a new app is not created at all.
   * @param id The app id, its folder under `store/`
   * @param source The compose YAML
   * @param create True to add a new app, which must not exist yet
   */
  async saveApp(id: string, source: string, create: boolean) {
    const folder = this.stackPath(id);

    if (this.config.shared().includes(id)) {
      throw new HangarError(`${id} is a shared file, not an app`);
    }

    if (create === (await exists(folder))) {
      throw new HangarError(create ? `The app ${id} already exists` : `The app ${id} does not exist`);
    }

    // Next to the real file, so the paths it references resolve the same way.
    const pending = path.join(folder, ".compose.pending.yml");

    // No `-p`: compose rejects some folder names as project names (`llama.cpp`), and a
    // validation does not need one.
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(pending, source, "utf8");

      // prettier-ignore
      await this.runtime.run("docker", [
        "compose",
        "--env-file", this.env.file(),
        "-f", pending,
        "config", "-q",
      ], { capture: true });
    } catch (error) {
      await rm(create ? folder : pending, { recursive: true, force: true });
      throw error;
    }

    await rename(pending, path.join(folder, "compose.yml"));
    await this.refresh();
  }

  /** The folder of a store app, once its id is known not to escape `store/`. */
  private stackPath(id: string) {
    if (!STACK_ID.test(id)) throw new HangarError(`Invalid app id: ${id}`);
    return path.join(this.storePath, "store", id);
  }

  /**
   * Returns the ids of installed apps.
   */
  installedProjectIds(): Set<string> {
    return new Set([...this.apps].flatMap(app => (app.installed ? [app.id] : [])));
  }

  /**
   * Refreshes store and installed apps.
   */
  async refresh() {
    this.apps.clear();

    if (await this.isInstalled()) {
      await this.config.load();

      const shared = this.config.shared();
      const entries = await readdir(path.join(this.storePath, "store"), { recursive: false });
      const apps = entries.filter(entry => !shared.includes(entry));
      const installed = await readdir(this.installedPath, { recursive: false });

      // One malformed app must not take down the whole store: log it and skip it.
      // refresh() runs in a module-level await on the server, so a rejection here
      // fails web app boot entirely.
      await Promise.all(
        apps.map(async app => {
          try {
            const source = await readFile(path.join(this.storePath, "store", app, "compose.yml"), "utf8");
            const yaml = load(source, { filename: "compose.yml" }) as Record<string, unknown> | undefined;
            const metadata = yaml?.["x-hangar"] as { icon?: string } | undefined;
            const services = (yaml?.["services"] ?? {}) as Record<string, { container_name?: string } | undefined>;

            // ponytail: the main service is the one named after the app, else the first declared;
            // a multi-service app that names neither falls back to its own id, which is what the
            // dashboard linked to before it read the compose file at all.
            const service = services[app] ?? Object.values(services)[0];

            this.apps.add({
              id: app,
              name: (yaml?.["name"] as string | undefined) ?? capitalize(app),
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
}
