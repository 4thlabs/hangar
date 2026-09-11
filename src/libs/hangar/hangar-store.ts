import { exists, run } from "./runtime/runtime.ts";
import { HangarConfig } from "./hangar-config.ts";
import { constants, mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";

type HangarApp = string;

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

  /** A list of all available App */
  availlableApps: HangarApp[] = [];

  /** A list of all installed App */
  installedApps: HangarApp[] = [];

  /**
   * Constructs the App Store
   * @param config Hangar configuration
   * @param dataDir Directory for storing data
   */
  constructor(config: HangarConfig, dataDir: string) {
    this.config = config;
    this.dataPath = path.resolve(process.env.HANGAR_DATA_DIR);
    this.storePath = path.join(this.dataPath, "app-store");
    this.installedPath = path.join(this.dataPath, "app-installed");
  }

  /**
   * Loads the available apps from the store directory
   * @returns The instance of the store
   */
  async load() {
    if (await this.isInstalled()) {
      this.availlableApps = await readdir(path.join(this.storePath, "store"), { recursive: false });
    }

    if (await exists(this.installedPath)) {
      this.installedApps = await readdir(this.installedPath, { recursive: false });
    }

    return this;
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
   * Install the store by cloning the repo
   */
  async install() {
    if (!(await this.isInstalled())) {
      await mkdir(this.installedPath);
      await run("git", "clone", "--", this.config.storeUrl, this.storePath);
    }

    const apps = this.resolve();

    // prettier-ignore
    await Promise.all(
      apps
          .map(async app => await this.link(app)
          .catch(ex => logger.error(ex, `Failed to link app: ${app}`))),
    );
  }

  /**
   * Updates the store by pulling -ff the repo
   */
  async update() {
    if (await this.isInstalled()) {
      await run("git", "-C", this.storePath, "pull", "--ff-only");
    }
  }

  /**
   * Runs docker compose against installed stacks
   */
  async compose(name: string, ...args: string[]) {}
}
