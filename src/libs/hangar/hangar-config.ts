import { load } from "js-yaml";
import { readFile } from "node:fs/promises";

/** A Stack category */
export type Category = { name: string; color: string; stacks: string[] };

/**
 * The configuration for Hangar
 */
export class HangarConfig {
  /** The URL of the hangar store */
  readonly storeUrl: string = "";

  /** The categories for the various stacks */
  readonly categories: Category[] = [];

  /**
   * Constructs a new HangarConfig instance with the given configuration file.
   * @param file The path to the configuration file
   */
  constructor(file: string) {
    this.storeUrl = "TODO: Implement store URL retrieval from config file";
  }

  /**
   * Loads the configuration from the configuration file.
   * @returns HangarConfig instance with the loaded configuration
   */
  async load() {
    const handle = await readFile(this.storeUrl, "utf8");
    const config = load(handle);
    return this;
  }
}
