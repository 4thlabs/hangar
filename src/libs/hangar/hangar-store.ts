import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";
import { logger } from "#libs/logs";
import { AppFiles } from "./app-files.ts";
import { HangarConfig } from "./hangar-config.ts";
import { HangarEnv } from "./hangar-env.ts";
import { HangarError, HangarRuntimeError } from "./hangar-error.ts";
import { Runtime, type CommandRunner, type RunOptions } from "./runtime/runtime.ts";

export type HangarApp = {
  id: string;
  /** `x-hangar.name`, else the compose file's top-level `name`, else the capitalized id. */
  name: string;
  icon: string | undefined;
  installed: boolean;
  /** Whether the app ships a `compose.swarm.yml`, so it can run in the swarm. */
  swarmReady: boolean;
  /** The container the app's own service declares, which Traefik routes `<container>.<DOMAIN>` to. */
  containerName: string;
};

/** The app store on disk: its stacks, the installed links, and the compose commands over them. */
export class HangarStore {
  /** Run order per compose command: 1 in stack order, -1 in reverse, absent means parallel */
  static readonly CommandOrder: Record<string, number> = { up: 1, start: 1, restart: 1, down: -1, stop: -1 };

  /** Commands that address the whole store instead of a single stack */
  static readonly GlobalCommand = ["up", "down", "pull"];

  /** Run order per stack verb, as {@link CommandOrder}: deploy forwards, remove backwards */
  private static readonly StackCommandOrder: Record<string, number> = { deploy: 1, rm: -1 };

  /** Stack verbs that address every `swarm:` app instead of a single one */
  static readonly GlobalStackCommand = ["deploy", "rm"];

  /** A stack id is a folder name under `store/` (`llama.cpp`): no separator, no leading dot, nothing to climb out with */
  private static readonly StackId = /^[a-z0-9][a-z0-9._-]*$/;

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
   * Whether `name` addresses several apps at once: the whole store (empty) or a category.
   * @param name A category or an app id
   */
  private isGroup(name: string) {
    return name === "" || this.config.categories().some(category => category.name === name);
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
    const compose = path.join(this.installedPath, stack, AppFiles.ComposeFile);

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

    await HangarStore.runInOrder(stacks, HangarStore.CommandOrder[command] ?? 0, stack =>
      this.composeStack(stack, args, options),
    );
  }

  /**
   * Runs `runOne` on every target: in parallel when `order` is 0, then surfacing the first failure;
   * otherwise one at a time, forwards (1) or backwards (-1), stopping at the first failure.
   */
  private static async runInOrder(targets: string[], order: number, runOne: (target: string) => Promise<unknown>) {
    if (order === 0) {
      const results = await Promise.allSettled(targets.map(runOne));
      const failure = results.find(result => result.status === "rejected");

      if (failure) {
        throw failure.reason;
      }

      return;
    }

    for (const target of order === 1 ? targets : [...targets].reverse()) {
      await runOne(target);
    }
  }

  /**
   * The `docker stack` call for one app, from a short verb, so the caller never writes the files or
   * the stack name, which is the app id. `.env.global` goes into the child's environment: unlike
   * compose, `docker stack` has no `--env-file`, and interpolates from its own.
   *
   * | Verb            | Runs                                                                  |
   * | --------------- | --------------------------------------------------------------------- |
   * | `deploy [args]` | `docker stack deploy -c compose.yml -c compose.swarm.yml …args <app>` |
   * | `config`        | `docker stack config -c compose.yml -c compose.swarm.yml`             |
   * | `rm`            | `docker stack rm <app>`                                               |
   * | `ps [args]`     | `docker stack ps …args <app>`                                         |
   * | `services`      | `docker stack services <app>`                                         |
   *
   * Any installed app with a `compose.swarm.yml` will do.
   * @param app The app id
   * @param args The verb, then arguments passed through to it
   * @param options Run options, forwarded to the runtime
   */
  private async stackApp(app: string, args: string[], options: RunOptions = {}) {
    const swarmFile = await this.installedSwarmFile(app);
    const files = ["-c", path.join(this.installedPath, app, AppFiles.ComposeFile), "-c", swarmFile];
    const [verb = "", ...rest] = args;

    const stackArgs: Record<string, string[]> = {
      deploy: ["deploy", ...files, ...rest, app],
      config: ["config", ...files, ...rest],
      rm: ["rm", ...rest, app],
      ps: ["ps", ...rest, app],
      services: ["services", ...rest, app],
    };

    const call = stackArgs[verb];

    if (!call) {
      throw new HangarRuntimeError(1, `Unknown swarm command: ${verb} (${Object.keys(stackArgs).join(", ")})`);
    }

    return this.runtime.run("docker", ["stack", ...call], { ...options, env: await this.env.read() });
  }

  /**
   * Runs a `docker stack` verb (see {@link stackApp}) against every `swarm:` app, a category, or one app.
   * The whole store and a category cover their apps that have a `compose.swarm.yml`, as `store up` covers
   * the apps of the categories; one app named directly needs one too.
   * @param name A global verb (`deploy`, `rm`), a category or an app id
   * @param args The verb, then arguments passed through to it
   * @param options Run options, forwarded to the runtime (`pipe` to capture the output)
   */
  async stack(name: string, args: string[], options?: RunOptions) {
    // `swarm deploy` / `swarm rm`: no target, the verb takes its place
    if (HangarStore.GlobalStackCommand.includes(name)) {
      args = [name, ...args];
      name = "";
    }

    const apps = this.isGroup(name) ? await this.swarmApps(name) : [name];

    await HangarStore.runInOrder(apps, HangarStore.StackCommandOrder[args[0] ?? ""] ?? 0, app =>
      this.stackApp(app, args, options),
    );
  }

  /**
   * Deploys an app's stack from the store: links it, then deploys it. Its compose project, if it runs, is
   * left alone: an app may run with both. `hangar.yml` is never edited.
   * @param app The app id; it must ship a `compose.swarm.yml`
   * @param options Run options for the stack call (`capture` to keep its output)
   */
  async deployToSwarm(app: string, options?: RunOptions) {
    await this.link(app);
    await this.installedSwarmFile(app);
    await this.env.ensure(app);

    try {
      await this.stackApp(app, ["deploy", "--quiet"], options);
    } finally {
      await this.refresh();
    }
  }

  /**
   * Whether Hangar can deploy this stack again and remove it: it is named after an installed app that
   * ships a `compose.swarm.yml`, whoever deployed it.
   */
  isStackManageable(name: string) {
    const app = this.app(name);

    return Boolean(app?.installed && app.swarmReady);
  }

  /**
   * Removes an app's stack on uninstall, when this node can: one that is no longer a manager cannot,
   * but the app must still be able to leave Hangar.
   * @returns Docker's complaint when the stack is left to remove from a manager, `null` once removed
   */
  async removeStackIfPossible(app: string): Promise<string | null> {
    return this.stackApp(app, ["rm"], { capture: true }).then(
      () => null,
      (error: unknown) => {
        if (error instanceof HangarError) {
          return error.message;
        }

        throw error;
      },
    );
  }

  /** Every stack name {@link isStackManageable} accepts. */
  manageableStacks(): string[] {
    return [...this.apps].map(app => app.id).filter(id => this.isStackManageable(id));
  }

  /** The installed app's compose.swarm.yml, or a rejection saying why the app cannot run in the swarm. */
  private async installedSwarmFile(app: string) {
    const swarmFile = path.join(this.installedPath, app, AppFiles.SwarmFile);

    if (!(await HangarStore.hasContent(swarmFile))) {
      throw new HangarRuntimeError(
        1,
        `${app} is not a swarm app: it has no ${AppFiles.SwarmFile}, or is not installed`,
      );
    }

    return swarmFile;
  }

  /** The apps of a group, in category order, that are installed with a `compose.swarm.yml`. */
  private async swarmApps(group: string) {
    const apps = this.resolve(group);

    const ready = await Promise.all(
      apps.map(app => HangarStore.hasContent(path.join(this.installedPath, app, AppFiles.SwarmFile))),
    );

    return apps.filter((_app, index) => ready[index]);
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
      await this.writeValidatedCompose(folder, path.join(folder, AppFiles.ComposeFile), source);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * The files of a store app, to list, read and write.
   * @param id The app id, its folder under `store/`; must already exist and not be a shared file
   */
  async files(id: string) {
    const folder = this.appFolder(id);

    if (!(await Runtime.exists(folder))) {
      throw new HangarError(`The app ${id} does not exist`);
    }

    return new AppFiles(id, folder, {
      compose: (appFolder, target, source) => this.writeValidatedCompose(appFolder, target, source),
      swarm: (appFolder, target, source) => this.writeValidatedSwarm(appFolder, target, source),
    });
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
   * Writes `source` to `target`, the compose file of the app in `folder`, if `docker compose config`
   * accepts it, and `docker stack config` too when the app has a compose.swarm.yml: an edit here can
   * break the stack (a top-level `name`, a `depends_on` condition).
   */
  private async writeValidatedCompose(folder: string, target: string, source: string) {
    const swarmFile = path.join(folder, AppFiles.SwarmFile);

    await this.writeThroughPending(folder, target, source, async pending => {
      // No `-p`: compose rejects some folder names as project names (`llama.cpp`), and a
      // validation does not need one.
      // prettier-ignore
      await this.runtime.run("docker", [
        "compose",
        "--env-file", this.env.file(),
        "-f", pending,
        "config", "-q",
      ], { capture: true });

      if (await HangarStore.hasContent(swarmFile)) {
        await this.checkStack(pending, swarmFile);
      }
    });
  }

  /**
   * Writes `source` to `target`, the compose.swarm.yml of the app in `folder`, if `docker stack config`
   * accepts it merged over the app's compose.yml. Works on any node, in a swarm or not.
   */
  private async writeValidatedSwarm(folder: string, target: string, source: string) {
    const composeFile = path.join(folder, AppFiles.ComposeFile);

    await this.writeThroughPending(folder, target, source, pending => this.checkStack(composeFile, pending));
  }

  /**
   * Writes `source` to a pending copy, has `validate` check it, then moves it onto `target` and reloads
   * the apps. On a rejection only the pending copy is removed.
   *
   * Unlike the other files, the compose files are replaced rather than rewritten in place: they must
   * stay untouched until validated, and Docker reads them anew on every command, so nothing holds them.
   */
  private async writeThroughPending(
    folder: string,
    target: string,
    source: string,
    validate: (pending: string) => Promise<void>,
  ) {
    // Next to the real file, so the paths it references resolve the same way; hidden, so the
    // listing leaves it out; named once per save, so two saves at once never remove each other's.
    const pending = path.join(folder, `.compose.${randomUUID()}.pending.yml`);

    try {
      // `wx`: a path already taken, a planted symlink included, fails instead of being written through.
      await writeFile(pending, source, { encoding: "utf8", flag: "wx" });
      await validate(pending);
      await rename(pending, target);
    } catch (error) {
      await rm(pending, { force: true });
      throw error;
    }

    await this.refresh();
  }

  /** Rejects with Docker's complaint unless `docker stack config` accepts the two files merged. */
  private async checkStack(composeFile: string, swarmFile: string) {
    // prettier-ignore
    await this.runtime.run("docker", [
      "stack", "config",
      "-c", composeFile,
      "-c", swarmFile,
    ], { capture: true, env: await this.env.read() });
  }

  /**
   * Whether a file exists with something in it: a fresh empty compose.swarm.yml, as the editor creates
   * it, does not make an app able to run in the swarm yet.
   */
  private static async hasContent(file: string) {
    const source = await readFile(file, "utf8").catch(() => "");

    return source.trim() !== "";
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
            const source = await readFile(path.join(this.storePath, "store", app, AppFiles.ComposeFile), "utf8");
            const yaml = load(source, { filename: AppFiles.ComposeFile }) as Record<string, unknown> | undefined;
            const metadata = yaml?.["x-hangar"] as { name?: string; icon?: string } | undefined;
            const services = (yaml?.["services"] ?? {}) as Record<string, { container_name?: string } | undefined>;

            // The main service is the one named after the app, else the first declared.
            const service = services[app] ?? Object.values(services)[0];

            // `x-hangar.name` first: Swarm rejects a top-level `name`, so a swarm-ready app moves it there.
            this.apps.add({
              id: app,
              name: metadata?.name ?? (yaml?.["name"] as string | undefined) ?? HangarStore.capitalize(app),
              icon: metadata?.icon,
              installed: installed.indexOf(app) !== -1,
              swarmReady: await HangarStore.hasContent(path.join(this.storePath, "store", app, AppFiles.SwarmFile)),
              containerName: service?.container_name ?? app,
            });
          } catch (error) {
            logger.warn("Skipping store app: its compose.yml could not be read", { error, app });
          }
        }),
      );
    }
  }

  /** Whether the compose args ask for detached mode. */
  private static detached(args: string[]) {
    return args.includes("-d") || args.includes("--detach");
  }

  private static capitalize(s: string) {
    return s && String(s[0]).toUpperCase() + String(s).slice(1);
  }
}
