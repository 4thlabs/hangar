import { HangarConfig } from "./hangar-config.ts";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";
import { load } from "js-yaml";
import { Runtime } from "./runtime/runtime.ts";
import { exists } from "./runtime/utils.ts";

export type HangarApp = {
  id: string;
  name: string;
  icon: string;
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
  private readonly config: HangarConfig;

  /** Runtime to launch commands */
  private readonly runtime: Runtime;

  /** A list of all available App */
  apps: Set<HangarApp> = new Set();

  /**
   * Constructs the App Store
   * @param config Hangar configuration
   * @param dataDir Directory for storing data
   */
  private constructor(config: HangarConfig, dataDir: string, runtime: Runtime) {
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
  static async create(config: HangarConfig, dataDir: string, runtime: Runtime) {
    const store = new HangarStore(config, dataDir, runtime);
    await store.refresh();
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
        this.config.categories
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
    if (!await exists(this.installedPath)) {
      await mkdir(this.installedPath);
    }
    
    await this.runtime.run("git", "clone", "--", this.config.storeUrl, this.storePath);
    
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
   * Runs docker compose against installed stacks
   */
  async compose(name: string, ...args: string[]) {}

  /**
   * Refreshes store and installed apps.
   */
  async refresh() {
    this.apps.clear();

    if (await this.isInstalled()) {
      const apps = await readdir(path.join(this.storePath, "store"), { recursive: false });
      const installed = await readdir(this.installedPath, { recursive: false });

      await Promise.all(
        apps.map(async app => {
          const source = await readFile(path.join(this.storePath, "store", app, "compose.yml"), "utf8");
          const yaml = load(source, { filename: "compose.yml" }) as Record<string, any>; //TODO: typechecking

          this.apps.add({
            id: app,
            name: yaml["name"] ?? app,
            icon: yaml["x-arcane"].icon,
            installed: installed.indexOf(app) !== -1,
          });
        }),
      );
    }
  }
}
