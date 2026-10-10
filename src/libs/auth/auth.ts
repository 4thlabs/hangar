import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import type { AnyRelations } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * How long, in seconds, a signed copy of the session in a cookie stands in for the database lookup.
 * The trade-off is revocation: a session deleted elsewhere (another device signing out, an account
 * removed) is still honoured by this browser for up to this long. Signing out here is immediate,
 * since it clears the cookie too.
 */
const SESSION_CACHE_MAX_AGE = 5 * 60;

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
    session: {
      cookieCache: {
        enabled: true,
        maxAge: SESSION_CACHE_MAX_AGE,
      },
    },
  });

export type Auth = ReturnType<typeof createAuth>;
