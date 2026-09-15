import "server-only";

import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "#libs/env";
import { authRelations } from "./schemas/auth-schema.ts";

export const db = drizzle({
  connection: {
    source: env.HANGAR_DB_HOST,
  },
  relations: { ...authRelations },
});
