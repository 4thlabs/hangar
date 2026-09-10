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
   * @param file The path to the configuration file
   * @param dataDir The Path to the data directory
   */
  private constructor(config: HangarConfig, store: HangarStore, db: NodeSQLiteDatabase) {
    this.db = db;
    this.config = config;
    this.store = store;
  }

  /**
   * Creates a new Hangar instance with the given configuration file and data directory.
   * @param file The path to the configuration file
   * @param dataDir The Path to the data directory
   * @returns 
   */
  static async create(file: string, dataDir: string) {
    const config = await new HangarConfig(file).load();
    const store = await new HangarStore(config, dataDir).load();
    
    return new Hangar(config, store, db);
  }
}

// Reused across HMR reloads, otherwise dev opens a new handle
const globalForHangar = globalThis as unknown as { hangar?: Hangar };

export const hangar = globalForHangar.hangar ?? await Hangar.create(process.env.HANGAR_CONFIG_FILE, process.env.HANGAR_DATA_DIR);

globalForHangar.hangar = hangar;
