import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { AnyRelations } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { Registration } from "./registration.ts";

/**
 * Better Auth for the Hangar project, on the database it is given. Sign-up only creates the first account:
 * see {@link Registration}.
 *
 * No import guard here: `server/server.ts`, which binds it, carries it (AGENTS.md).
 * @param onSessionEnd Called with the user's id once one of their sessions is deleted: signed out, or revoked
 */
export const createAuth = <TRelations extends AnyRelations>(
  db: BetterSQLite3Database<TRelations>,
  onSessionEnd: (userId: string) => Promise<void> = async () => {},
) => {
  const registration = new Registration(db);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
    },
    databaseHooks: {
      user: {
        create: {
          // On the row rather than the endpoint: every way of creating a user goes through it.
          before: async () => {
            if (!(await registration.isOpen())) {
              throw new APIError("FORBIDDEN", { message: Registration.ClosedMessage });
            }
          },
        },
      },
      session: {
        delete: {
          after: async session => {
            await onSessionEnd(session.userId);
          },
        },
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
