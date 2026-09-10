import { exists, run } from "#libs/runtime";
import { HangarConfig } from "./hangar-config.ts";
import { mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";

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
   * @returns
   */
  async load() {
    this.availlableApps = await readdir(path.join(this.storePath, "store"), { recursive: false });
    this.installedApps = await readdir(this.installedPath, { recursive: false });

    return this;
  }

  async linkAll() {}

  async link(name: string) {
    const source = path.join(this.storePath, "store", name);
    const destination = path.join(this.installedPath, name);

    if ((await exists(source)) && !(await exists(destination))) {
      await symlink(path.join(this.storePath, name), path.join(this.installedPath, name), "dir");
    }
  }

  /**
   * Returns true if the store is installed, false otherwise
   * @returns boolean indicating if the store is installed
   */
  async isInstalled() {
    return exists(path.join(this.storePath, ".git"));
  }

  async install() {
    if (!(await this.isInstalled())) {
      const code = await run("git", "clone", "--", this.config.storeUrl, this.storePath);
    }
  }

  async update() {
    if (await this.isInstalled()) {
      const code = await run("git", "-C", this.storePath, "pull", "--ff-only");
    }
  }
}
