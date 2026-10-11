import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";
import { logger } from "#libs/logs";
import { AppFiles } from "./app-files.ts";
import { ConfigCheck } from "./config-check.ts";
import { HangarConfig, type Config } from "./hangar-config.ts";
import { HangarEnv } from "./hangar-env.ts";
import { HangarError, HangarRuntimeError } from "./hangar-error.ts";
import { Runtime, type CommandRunner, type RunOptions } from "./runtime/runtime.ts";

export type HangarApp = {
  id: string;
  /** `x-hangar.name`, else the compose file's top-level `name`, else the capitalized id. */
  name: string;
  icon: string | undefined;
  /** Whether the app ships a `compose.swarm.yml`, so it can run in the swarm. */
  swarmReady: boolean;
  /** The container the app's own service declares, which Traefik routes `<container>.<DOMAIN>` to. */
  containerName: string;
};

/** What a CLI name addresses: the whole store, one category, or one app. */
export type StoreTarget = { kind: "all" } | { kind: "category"; name: string } | { kind: "app"; id: string };

/**
 * The app store on disk: its apps, and the compose and stack commands over them. Hangar keeps no state
 * of its own about them: `hangar.yml` declares, Docker says what runs.
 */
export class HangarStore {
  /** Run order per compose command: 1 in stack order, -1 in reverse, absent means parallel */
  static readonly CommandOrder: Record<string, number> = { up: 1, start: 1, restart: 1, down: -1, stop: -1 };

  /** Commands that address the whole store instead of a single stack */
  private static readonly GlobalCommand = ["up", "down", "pull"];

  /**
   * The `store` command's own words, the global commands and its subcommands: a category named after one
   * could never be addressed. `swarm` takes no category, so its `deploy` and `rm` are free.
   */
  static readonly CliWords = [...HangarStore.GlobalCommand, "install", "ls"];

  /** Run order per stack verb, as {@link CommandOrder}: deploy forwards, remove backwards */
  private static readonly StackCommandOrder: Record<string, number> = { deploy: 1, rm: -1 };

  /** Stack verbs that address the whole `swarm:` list of hangar.yml instead of a single app */
  private static readonly GlobalStackCommand = ["deploy", "rm"];

  /** The whole-store compose commands that start apps, or ready them to start: they skip `run: false` */
  private static readonly StartCommand = ["up", "pull"];

  /** What compose accepts as a project name, which an app id becomes (`-p <app>`) */
  static readonly ProjectName = /^[a-z0-9][a-z0-9_-]*$/;

  /** A stack id is a folder name under `store/` (`llama.cpp`): no separator, no leading dot, nothing to climb out with */
  private static readonly StackId = /^[a-z0-9][a-z0-9._-]*$/;

  readonly dataPath: string;

  /** The clone of the store repository. */
  readonly storePath: string;

  /** The clone's `store/` folder: one folder per app, and the shared fragments next to them. */
  readonly appsPath: string;

  readonly url: string;

  /** Configuration shipped by the store, empty until the store is on disk */
  readonly config: HangarConfig;

  /** The global environment every stack is composed with */
  readonly env: HangarEnv;

  private readonly runtime: CommandRunner;

  /** What {@link checkConfig} last logged, so the same report is not logged twice in a row */
  private lastConfigReport = "";

  /** Every app the store carries: each folder of `store/` holding a compose file. */
  apps: Set<HangarApp> = new Set();

  /**
   * @param url The store repository to clone
   * @param dataDir Where the store, the global environment and the app data live
   */
  constructor(url: string, dataDir: string, runtime: CommandRunner) {
    this.url = url;
    this.dataPath = path.resolve(dataDir);
    this.storePath = path.join(this.dataPath, "app-store");
    this.appsPath = path.join(this.storePath, "store");
    this.config = new HangarConfig(path.join(this.storePath, "config", "hangar.yml"));
    // APP_DATA_DIR is the one variable Hangar can answer for the operator: the stacks keep
    // their data under the same resolved data directory Hangar itself uses.
    this.env = new HangarEnv(this.dataPath, this.appsPath, async () => this.envScope(), {
      APP_DATA_DIR: path.join(this.dataPath, "app-data"),
    });

    this.runtime = runtime;
  }

  /**
   * What a name addresses: no name the whole store, a category its own apps, anything else one app.
   * A category named like an app wins, which a save refuses (see {@link ConfigCheck}).
   * @param name Empty, a category or an app id
   */
  target(name: string = ""): StoreTarget {
    if (name === "") {
      return { kind: "all" };
    }

    if (this.config.categories().some(category => category.name === name)) {
      return { kind: "category", name };
    }

    return { kind: "app", id: name };
  }

  /**
   * The compose apps a group covers, in start order, minus the `run: false` ones when a start
   * command covers the whole store.
   * @param target The whole store or a category
   * @param command The compose command
   */
  private groupApps(target: StoreTarget, command: string) {
    const isBulkStart = target.kind === "all" && HangarStore.StartCommand.includes(command);
    const category = target.kind === "category" ? target.name : undefined;

    return this.config
      .entries(category)
      .filter(entry => entry.run || !isBulkStart)
      .map(entry => entry.id);
  }

  /**
   * Rejects a name that is neither a category nor an app of the store: a folder of `store/` holding a
   * compose file, so a shared fragment (`networks.yml`) is no app either.
   * @param id The name, taken for an app id
   */
  private async requireApp(id: string) {
    if (!(await this.isStoreApp(id))) {
      throw new HangarRuntimeError(1, `Unknown app or category: ${id}`);
    }
  }

  /** Rejects an id that is no app of the store, or one compose would refuse as a project name. */
  private async requireComposeApp(id: string) {
    await this.requireApp(id);

    if (!HangarStore.ProjectName.test(id)) {
      throw new HangarRuntimeError(
        1,
        `${id} cannot run with compose: a project name takes lowercase letters, digits, - and _; rename its folder`,
      );
    }
  }

  /**
   * The one rule for what an app is: a folder of `store/`, named as an app id may be, holding a compose
   * file. A shared fragment (`networks.yml`) or a folder with no compose file is no app.
   */
  private async isStoreApp(id: string) {
    return HangarStore.StackId.test(id) && Runtime.exists(path.join(this.appsPath, id, AppFiles.ComposeFile));
  }

  /**
   * The apps hangar.yml declares, in a category or in the swarm list: what a full `.env.global` scan
   * covers. An id that is no folder name is left out: it would read outside `store/`.
   */
  private envScope() {
    return [...new Set([...this.declaredAppIds(), ...this.config.swarm()])].filter(id => HangarStore.StackId.test(id));
  }

  /** The apps of the categories: each gets an Apps page row, even with no container. */
  declaredAppIds(): Set<string> {
    return new Set(this.config.entries().map(entry => entry.id));
  }

  /** Every app of the store: one Docker runs a compose project for gets an Apps page row too. */
  appIds(): Set<string> {
    return new Set([...this.apps].map(app => app.id));
  }

  /**
   * Writes hangar.yml, then reloads the apps.
   * @param source The YAML; an invalid one, or one {@link ConfigCheck} finds a problem in, throws and
   * leaves the file untouched
   */
  async saveConfig(source: string) {
    const problems = await this.configProblems(this.config.parse(source));

    if (problems.length > 0) {
      throw new HangarError(`Invalid Hangar config:\n${problems.map(problem => `✖ ${problem}`).join("\n")}`);
    }

    await this.config.write(source);
    await this.refresh();
  }

  /** Loads hangar.yml, then {@link checkConfig}: what the CLI and an install start from. */
  async loadConfig() {
    await this.config.load();
    await this.checkConfig();
  }

  /**
   * Logs what {@link ConfigCheck} finds wrong with the loaded hangar.yml, without refusing it: a file
   * that loaded before must keep the server booting, and each problem has a fallback (see the spec).
   * Called at boot, by each command and after a pull, not on every {@link refresh}; a report identical to
   * the last one is not logged again, so `store install` does not repeat what the command already said.
   */
  async checkConfig() {
    const config = { categories: this.config.categories(), swarm: this.config.swarm() };
    const problems = await this.configProblems(config);

    if (this.config.listsShared()) {
      problems.push("shared is no longer read, and can be removed: an app is a folder holding a compose file");
    }

    const report = problems.join("\n");

    if (report === this.lastConfigReport) {
      return;
    }

    this.lastConfigReport = report;

    for (const problem of problems) {
      logger.warn(`hangar.yml: ${problem}`);
    }
  }

  /** What {@link ConfigCheck} finds wrong with a config, against the apps the store holds now. */
  private async configProblems(config: Pick<Config, "categories" | "swarm">) {
    return new ConfigCheck(this.appsPath, HangarStore.CliWords).problems(config, new Set(await this.appFolders()));
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
    if (await this.isInstalled()) {
      await this.runtime.run("git", ["-C", this.storePath, "pull", "--ff-only"]);
    } else {
      await this.runtime.run("git", ["clone", "--", this.url, this.storePath]);
    }

    // The categories only exist once the clone brought hangar.yml in.
    await this.loadConfig();

    // The stacks are composed with .env.global: without it every compose call fails, so a
    // fresh install leaves the operator the list of variables to fill rather than nothing.
    await this.env.ensure();
  }

  /**
   * Runs docker compose against a single app of the store, its id already checked by the caller
   * @param stack The stack name
   * @param args Arguments passed through to docker compose
   * @param options Run options, forwarded to the runtime (`pipe` to capture the output)
   */
  private async composeStack(stack: string, args: string[], options?: RunOptions) {
    const compose = path.join(this.appsPath, stack, AppFiles.ComposeFile);

    // `-p` pins the project to the stack name: the compose file's `name:` is a display label
    // ("Home Assistant"), and compose would derive the project from it by dropping everything
    // outside [a-z0-9_-] ("homeassistant"), so its containers no longer match the app.
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
   * Runs docker compose against one app, its id taken as is: never read as a category or a whole-store
   * word, so an app named like one is still only itself. What the site and the jobs call.
   * @param app The app id
   * @param args Arguments passed through to docker compose
   * @param options Run options, forwarded to the runtime (`pipe` to stream the output)
   */
  async composeApp(app: string, args: string[], options?: RunOptions) {
    await this.requireComposeApp(app);

    return this.composeStack(app, args, options);
  }

  /**
   * Runs docker compose against the apps of the whole store or of a category, or against a single app.
   * On the whole store, `up` and `pull` leave out the `run: false` ones.
   * @param name A global command, a category or an app id
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
    const stacks = await this.composeApps(this.target(name), command);

    if (stacks.length === 0) {
      logger.info(`No compose app to run ${command} on in ${name || "the store"}`);

      return;
    }

    if (command === "up" && !HangarStore.detached(args) && stacks.length > 1) {
      throw new HangarRuntimeError(1, "Non detached mode only authorised on a single stack");
    }

    await HangarStore.runInOrder(stacks, HangarStore.CommandOrder[command] ?? 0, stack =>
      this.composeStack(stack, args, options),
    );
  }

  /**
   * The apps a compose command covers. A group leaves out, with a warning, the entries compose cannot
   * run: an id with no folder in the store, or one compose rejects as a project name.
   */
  private async composeApps(target: StoreTarget, command: string) {
    if (target.kind === "app") {
      await this.requireComposeApp(target.id);

      return [target.id];
    }

    const apps = this.groupApps(target, command);
    const runnable = await Promise.all(apps.map(app => this.isComposeRunnable(app)));

    return apps.filter((_app, index) => runnable[index]);
  }

  /** Whether a declared app can run with compose; logs why when it cannot. */
  private async isComposeRunnable(app: string) {
    if (!HangarStore.ProjectName.test(app)) {
      logger.warn(`Skipping ${app}: compose rejects it as a project name`);

      return false;
    }

    if (!(await this.isStoreApp(app))) {
      logger.warn(`Skipping ${app}: not an app of the store`);

      return false;
    }

    return true;
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
   * Any app with a `compose.swarm.yml` will do. Its id is taken as is: never read as `deploy` or `rm` of
   * the whole swarm list, so an app named like one is still only itself. What the site calls.
   * @param app The app id
   * @param args The verb, then arguments passed through to it
   * @param options Run options, forwarded to the runtime
   */
  async stackApp(app: string, args: string[], options: RunOptions = {}) {
    await this.requireApp(app);

    const swarmFile = await this.swarmFile(app);
    const files = ["-c", path.join(this.appsPath, app, AppFiles.ComposeFile), "-c", swarmFile];
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
   * Runs a `docker stack` verb (see {@link stackApp}) against the `swarm:` list of hangar.yml, in its
   * order, or against one app, which needs a `compose.swarm.yml`. Categories group the compose apps, so a
   * category is refused. Independent of {@link compose}: an app may run both ways.
   * @param name A global verb (`deploy`, `rm`) or an app id
   * @param args The verb, then arguments passed through to it
   * @param options Run options, forwarded to the runtime (`pipe` to capture the output)
   */
  async stack(name: string, args: string[], options?: RunOptions) {
    // `swarm deploy` / `swarm rm`: no target, the verb takes its place
    if (HangarStore.GlobalStackCommand.includes(name)) {
      args = [name, ...args];
      name = "";
    }

    const verb = args[0] ?? "";
    const target = this.target(name);

    if (target.kind === "category") {
      throw new HangarRuntimeError(
        1,
        `${name} is a category: categories group the compose apps. Name an app, or deploy / rm the swarm: list`,
      );
    }

    const apps = target.kind === "app" ? [target.id] : await this.swarmApps();

    if (apps.length === 0) {
      logger.info(`No swarm app to run ${verb} on in the swarm: list of hangar.yml`);

      return;
    }

    await HangarStore.runInOrder(apps, HangarStore.StackCommandOrder[verb] ?? 0, app =>
      this.stackApp(app, args, options),
    );
  }

  /**
   * Deploys an app's stack from the store. Its compose project, if it runs, is left alone: an app may run
   * with both. `hangar.yml` is never edited.
   * @param app The app id; it must ship a `compose.swarm.yml`
   * @param options Run options for the stack call (`capture` to keep its output)
   */
  async deployToSwarm(app: string, options?: RunOptions) {
    // Checked before seeding: an app that cannot run in the swarm leaves .env.global as it was.
    await this.swarmFile(app);
    await this.env.ensure(app);
    await this.stackApp(app, ["deploy", "--quiet"], options);
  }

  /**
   * Whether Hangar can deploy this stack again and remove it: it is named after a store app that ships a
   * `compose.swarm.yml`, whoever deployed it.
   */
  isStackManageable(name: string) {
    return Boolean(this.app(name)?.swarmReady);
  }

  /** Every stack name {@link isStackManageable} accepts. */
  manageableStacks(): string[] {
    return [...this.appIds()].filter(id => this.isStackManageable(id));
  }

  /** The app's compose.swarm.yml, or a rejection saying the app cannot run in the swarm. */
  private async swarmFile(app: string) {
    if (!(await AppFiles.isSwarmReady(path.join(this.appsPath, app)))) {
      throw new HangarRuntimeError(1, `${app} is not a swarm app: it has no ${AppFiles.SwarmFile}`);
    }

    return path.join(this.appsPath, app, AppFiles.SwarmFile);
  }

  /**
   * The `swarm:` list, in deploy order, minus the apps without a `compose.swarm.yml`, which are skipped
   * with a warning: the list named them, so a silent skip would hide a mistake.
   */
  private async swarmApps() {
    // An id that is no folder name is left out before any path is built from it.
    const apps = [...new Set(this.config.swarm())].filter(app => HangarStore.StackId.test(app));
    const ready = await Promise.all(apps.map(app => AppFiles.isSwarmReady(path.join(this.appsPath, app))));

    for (const app of apps.filter((_app, index) => !ready[index])) {
      logger.warn(`Skipping ${app}: it has no ${AppFiles.SwarmFile}`);
    }

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
    const folder = this.stackPath(id);

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
   * @param id The app id, its folder under `store/`; must already hold a compose file
   */
  async files(id: string) {
    const folder = this.stackPath(id);

    if (!(await this.isStoreApp(id))) {
      throw new HangarError(`The app ${id} does not exist`);
    }

    return new AppFiles(id, folder, {
      compose: (appFolder, target, source) => this.writeValidatedCompose(appFolder, target, source),
      swarm: (appFolder, target, source) => this.writeValidatedSwarm(appFolder, target, source),
    });
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

      if (await AppFiles.isSwarmReady(folder)) {
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

  /** The folder of a store app, once its id is known not to escape `store/`. */
  private stackPath(id: string) {
    if (!HangarStore.StackId.test(id)) {
      throw new HangarError(`Invalid app id: ${id}`);
    }

    return path.join(this.appsPath, id);
  }

  /**
   * Reloads `hangar.yml` and every app's compose file. The new list replaces the old one only once
   * complete, so a reader in between still sees every app.
   */
  async refresh() {
    const loaded = new Set<HangarApp>();

    if (await this.isInstalled()) {
      await this.config.load();

      const apps = await this.appFolders();

      // One malformed app is skipped: a rejection here would fail the server's boot.
      await Promise.all(
        apps.map(async app => {
          try {
            const source = await readFile(path.join(this.appsPath, app, AppFiles.ComposeFile), "utf8");
            const yaml = load(source, { filename: AppFiles.ComposeFile }) as Record<string, unknown> | undefined;
            const metadata = yaml?.["x-hangar"] as { name?: string; icon?: string } | undefined;
            const services = (yaml?.["services"] ?? {}) as Record<string, { container_name?: string } | undefined>;

            // The main service is the one named after the app, else the first declared.
            const service = services[app] ?? Object.values(services)[0];

            // `x-hangar.name` first: Swarm rejects a top-level `name`, so a swarm-ready app moves it there.
            loaded.add({
              id: app,
              name: metadata?.name ?? (yaml?.["name"] as string | undefined) ?? HangarStore.capitalize(app),
              icon: metadata?.icon,
              swarmReady: await AppFiles.isSwarmReady(path.join(this.appsPath, app)),
              containerName: service?.container_name ?? app,
            });
          } catch (error) {
            logger.warn("Skipping store app: its compose.yml could not be read", { error, app });
          }
        }),
      );
    }

    this.apps = loaded;
  }

  /**
   * The folders of `store/` holding a compose file: the store's apps, none before the clone. A shared
   * fragment (`networks.yml`) or a folder with no compose file is no app.
   */
  private async appFolders() {
    const entries = await readdir(this.appsPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

    const folders = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    const apps = await Promise.all(folders.map(async folder => ((await this.isStoreApp(folder)) ? [folder] : [])));

    return apps.flat();
  }

  /** Whether the compose args ask for detached mode. */
  private static detached(args: string[]) {
    return args.includes("-d") || args.includes("--detach");
  }

  private static capitalize(s: string) {
    return s && String(s[0]).toUpperCase() + String(s).slice(1);
  }
}
