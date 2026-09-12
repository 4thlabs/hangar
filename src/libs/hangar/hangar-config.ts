import { load } from "js-yaml";
import { readFile } from "node:fs/promises";

/** A Stack category */
export type Category = { name: string; color: string; stacks: string[] };
export type Config = { store: string; categories: Category[] };

/**
 * The configuration for Hangar
 */
export class HangarConfig {
  /** The config file */
  readonly configFile: string;

  /** The URL of the hangar store */
  storeUrl: string = "";

  /** The categories for the various stacks */
  categories: Category[] = [];

  /**
   * Constructs a new HangarConfig instance with the given configuration file.
   * @param file The path to the configuration file
   */
  private constructor(file: string) {
    this.configFile = file;
  }

  /**
   * Statis async contructor
   * @param file 
   */
  static async create(file: string) {
    const config = new HangarConfig(file);
    await config.load();
    return config;
  }

  /**
   * Loads the configuration from the configuration file.
   * @returns HangarConfig instance with the loaded configuration
   */
  async load() {
    const handle = await readFile(this.configFile, "utf8");
    const config = load(handle) as Config;

    this.storeUrl = config.store;
    this.categories = config.categories;

    return this;
  }
}
