import "#libs/env";
import { HangarStore } from "./hangar-store.ts";
import { HangarConfig } from "./hangar-config.ts";
import { Runtime } from "./runtime/runtime.ts";

/**
 * Hangar is the main class of the Hangar library. It provides access to the configuration and the app store.
 */
export class Hangar {
  /** The configuration for the Hangar instance */
  readonly config: HangarConfig;
  /** The app store for the Hangar instance */
  readonly store: HangarStore;
  /** The runtime for hangar */
  readonly runtime: Runtime;

  private constructor(config: HangarConfig, runtime: Runtime, store: HangarStore) {
    this.config = config;
    this.runtime = runtime;
    this.store = store;
  }

  /**
   * Creates a new Hangar instance with the given configuration file and data directory.
   * @param file The path to the configuration file
   * @param dataDir The path to the data directory
   * @returns the hangar instance
   */
  static async create(file: string, dataDir: string) {
    const config = await HangarConfig.create(file);
    const runtime = new Runtime();
    const store = await HangarStore.create(config, dataDir, runtime);

    return new Hangar(config, runtime, store);
  }
}
