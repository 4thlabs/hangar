import "#libs/env";
import { db } from "#libs/db";
import { HangarStore } from "./hangar-store.ts";
import { HangarConfig } from "./hangar-config.ts";
import { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

/**
 * Hangar is the main class of the Hangar library. It provides access to the configuration and the app store.
 */
class Hangar {
  /** The configuration for the Hangar instance */
  readonly config: HangarConfig;
  /** The app store for the Hangar instance */
  readonly store: HangarStore;
  /** The database for the Hangar instance */
  readonly db: NodeSQLiteDatabase;

  /**
   * Constructs a new Hangar instance with the given configuration file and data directory.
   * @param file
   * @param dataDir
   */
  constructor(file: string, dataDir: string) {
    this.db = db;
    this.config = new HangarConfig(file);
    this.store = new HangarStore(this.config, dataDir);
  }
}

// Reused across HMR reloads, otherwise dev opens a new handle
const globalForHangar = globalThis as unknown as { hangar?: Hangar };

export const hangar = globalForHangar.hangar ?? new Hangar(process.env.HANGAR_CONFIG_FILE, process.env.HANGAR_DATA_DIR);

globalForHangar.hangar = hangar;
