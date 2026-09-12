import { drizzle } from "drizzle-orm/node-sqlite";
import { env } from "#libs/env";
import { authRelations } from "./schemas/auth-schema.ts";

export const db = drizzle({
  connection: {
    path: env.HANGAR_DB_HOST,
  },
  relations: { ...authRelations },
});
