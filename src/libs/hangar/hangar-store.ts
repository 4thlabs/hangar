import { type ConfigurationProvider } from "./hangar-config.ts";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";
import { load } from "js-yaml";
import { type CommandRunner } from "./runtime/runtime.ts";
import { exists } from "./runtime/utils.ts";
import { HangarRuntimeError } from "./hangar-error.ts";

/** Run order per compose command: 1 in stack order, -1 in reverse, absent means parallel */
const ORDER: Record<string, number> = { up: 1, start: 1, restart: 1, down: -1, stop: -1 };

/** Commands that address the whole store instead of a single stack */
const GLOBALS = ["up", "down", "pull"];

/** True when the compose args ask for detached mode */
const detached = (args: string[]) => args.includes("-d") || args.includes("--detach");

export type HangarApp = {
  id: string;
  name: string;
  icon: string | undefined;
  installed: boolean;
};

/**
 * Representation of the App Store
 */
export class HangarStore {
  /** Path of Hangar sata */
  readonly dataPath: string;

  /** Path where the app are installed */
  readonly installedPath: string;

  /** Path of the store */
  readonly storePath: string;

  /** Hangar configuration */
  private readonly config: ConfigurationProvider;

  /** Runtime to launch commands */
  private readonly runtime: CommandRunner;

  /** A list of all available App */
  apps: Set<HangarApp> = new Set();

  /**
   * Constructs the App Store
   * @param config Hangar configuration
   * @param dataDir Directory for storing data
   */
  private constructor(config: ConfigurationProvider, dataDir: string, runtime: CommandRunner) {
    this.config = config;
    this.dataPath = path.resolve(dataDir);
    this.storePath = path.join(this.dataPath, "app-store");
    this.installedPath = path.join(this.dataPath, "app-installed");
    this.runtime = runtime;
  }

  /**
   * Creates the store
   * @returns The instance of the store
   */
  static async create(config: ConfigurationProvider, dataDir: string, runtime: CommandRunner) {
    const store = new HangarStore(config, dataDir, runtime);
    return store;
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
   * Returns true if the store is installed, false otherwise
   * @returns boolean indicating if the store is installed
   */
  async isInstalled() {
    return exists(path.join(this.storePath, ".git"));
  }

  /**
   * Installs the store by cloning the source and linking apps
   */
  private async install() {
    if (!(await exists(this.installedPath))) {
      await mkdir(this.installedPath);
    }

    await this.runtime.run("git", "clone", "--", this.config.storeUrl(), this.storePath);

    const apps = this.resolve();

    // prettier-ignore
    await Promise.all(
      apps
        .map(async app => await this.link(app)
        .catch(ex => logger.error(ex, `Failed to link app: ${app}`))),
    );
  }

  /**
   * Install the store by cloning the repo or updates it
   * @param update boolean Wheter to update the store if already installed
   */
  async update(install: boolean = false) {
    if (await this.isInstalled()) {
      await this.runtime.run("git", "-C", this.storePath, "pull", "--ff-only");
    } else if (install) {
      await this.install();
    }
  }

  /**
   * Runs docker compose against a single installed stack
   * @param stack The stack name
   * @param args Arguments passed through to docker compose
   */
  private async composeStack(stack: string, ...args: string[]) {
    const compose = path.join(this.installedPath, stack, "compose.yml");

    if (!(await exists(compose))) {
      throw new HangarRuntimeError(1, `Failed to find project: ${stack}`);
    }

    // prettier-ignore
    return this.runtime.run("docker", "compose",
      "--env-file", path.join(this.installedPath, ".env.global"),
      "-f", compose,
      ...args,
    );
  }

  /**
   * Runs docker compose against every stack, a category or a single stack.
   * @param name A global command, a category or a stack name
   * @param args Arguments passed through to docker compose
   */
  async compose(name: string, ...args: string[]) {
    // `store up -d` / `store down` / `store pull`: no target, the command takes its place
    if (GLOBALS.includes(name)) {
      args = [name, ...args];
      name = "";
    }

    const command = args[0] ?? "";
    const stacks = this.resolve(name);

    if (command === "up" && !detached(args) && stacks.length > 1) {
      throw new HangarRuntimeError(1, "Non detached mode only authorised on a single stack");
    }

    const order = ORDER[command] ?? 0;

    // Unordered: let every stack run, then surface the first failure.
    if (order === 0) {
      const results = await Promise.allSettled(stacks.map(stack => this.composeStack(stack, ...args)));
      const failure = results.find(result => result.status === "rejected");

      if (failure) throw failure.reason;
      return;
    }

    // Ordered: stop at the first failure, up/start forwards, down/stop backwards.
    for (const stack of order === 1 ? stacks : [...stacks].reverse()) {
      await this.composeStack(stack, ...args);
    }
  }

  /**
   * Refreshes store and installed apps.
   */
  async refresh() {
    this.apps.clear();

    if (await this.isInstalled()) {
      const apps = await readdir(path.join(this.storePath, "store"), { recursive: false });
      const installed = await readdir(this.installedPath, { recursive: false });

      // One malformed app must not take down the whole store: log it and skip it.
      // refresh() runs in a module-level await on the server, so a rejection here
      // fails web app boot entirely.
      await Promise.all(
        apps.map(async app => {
          try {
            const source = await readFile(path.join(this.storePath, "store", app, "compose.yml"), "utf8");
            const yaml = load(source, { filename: "compose.yml" }) as Record<string, unknown> | undefined;
            const metadata = yaml?.["x-arcane"] as { icon?: string } | undefined;

            this.apps.add({
              id: app,
              name: (yaml?.["name"] as string | undefined) ?? app,
              icon: metadata?.icon,
              installed: installed.indexOf(app) !== -1,
            });
          } catch (error) {
            logger.warn({ error, app }, "Skipping store app: its compose.yml could not be read");
          }
        }),
      );
    }
  }
}
