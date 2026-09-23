import "#libs/env";
import { HangarStore } from "./hangar-store.ts";
import { Runtime } from "./runtime/runtime.ts";

/**
 * Hangar is the main class of the Hangar library. It provides access to the configuration and the app store.
 */
export class Hangar {
  /** The app store for the Hangar instance */
  readonly store: HangarStore;
  /** The runtime for hangar */
  readonly runtime: Runtime;

  /** The configuration, which the store owns and loads from its own hangar.yml */
  get config() {
    return this.store.config;
  }

  private constructor(runtime: Runtime, store: HangarStore) {
    this.runtime = runtime;
    this.store = store;
  }

  /**
   * Creates a new Hangar instance with the given store URL and data directory.
   * @param url The URL of the store repository
   * @param dataDir The path to the data directory
   * @returns the hangar instance
   */
  static async create(url: string, dataDir: string) {
    const runtime = new Runtime();
    const store = new HangarStore(url, dataDir, runtime);

    return new Hangar(runtime, store);
  }
}
