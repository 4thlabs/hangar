import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import type { AnyRelations } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * Better Auth for the Hangar project, on the database it is given.
 *
 * No import guard here: `server/server.ts`, which binds it, carries it (AGENTS.md).
 */
export const createAuth = <TRelations extends AnyRelations>(db: BetterSQLite3Database<TRelations>) =>
  betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
    },
  });

export type Auth = ReturnType<typeof createAuth>;
