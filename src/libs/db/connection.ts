import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "#libs/env";
import { authRelations } from "./schemas/auth-schema.ts";

/**
 * The database handle. The `server-only` guard lives on `#libs/db/server`, not here: Sidequest
 * loads a job module in a plain Node process, where that marker throws, and a job still needs
 * to read and write.
 */
export const db = drizzle({
  connection: {
    source: env.HANGAR_DB_HOST,
  },
  relations: { ...authRelations },
});
