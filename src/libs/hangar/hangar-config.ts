import { load } from "js-yaml";
import { readFile } from "node:fs/promises";

/** A Stack category */
export type Category = { name: string; color: string; stacks: string[] };
export type Config = { store: string; categories: Category[] };

/**
 * HangarConfig interface
 */
export interface ConfigurationProvider {
  storeUrl: () => string;
  categories: () => Category[];
}

/**
 * The configuration for Hangar
 */
export class HangarConfig implements ConfigurationProvider{
  /** The config file */
  private readonly _configFile: string;

  /** The URL of the hangar store */
  private _storeUrl: string = "";

  /** The categories for the various stacks */
  private _categories: Category[] = [];

  /** Returns the store URL */
  public storeUrl = () => this._storeUrl;
  
  /** Returns the categories */
  public categories = () => this._categories;

  /**
   * Constructs a new HangarConfig instance with the given configuration file.
   * @param file The path to the configuration file
   */
  private constructor(file: string) {
    this._configFile = file;
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
    const handle = await readFile(this._configFile, "utf8");
    const config = load(handle) as Config;

    this._storeUrl = config.store;
    this._categories = config.categories;

    return this;
  }
}
