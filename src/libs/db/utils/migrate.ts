import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "#libs/env";

/**
 * The container runs this before the server so a fresh volume gets its tables.
 *
 * It deliberately does not import `#libs/db/server`: that entry is `server-only`,
 * which throws outside the `react-server` condition. Migrations need a
 * connection, not the schema, so open a plain one.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export function migrateDb(source = env.HANGAR_DB_HOST) {
  // The image points HANGAR_DB_HOST at a nested path inside the /app/data volume,
  // and better-sqlite3 will not create the directories itself.
  if (source !== ":memory:") mkdirSync(path.dirname(source), { recursive: true });

  const db = drizzle({ connection: { source } });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return db;
}

if (import.meta.main) {
  migrateDb().$client.close();
  console.log(`Migrations applied to ${env.HANGAR_DB_HOST}`);
}
