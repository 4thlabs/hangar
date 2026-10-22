import type { AnyRelations } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { user } from "#libs/db";

/**
 * Whether an account may still be created: only the first one is. An account runs `docker compose` on the
 * host and opens its terminals, and Hangar has no roles, so the sign-up page would otherwise hand that to
 * anyone who reaches it.
 *
 * No import guard here: `server/server.ts`, which binds it, carries it (AGENTS.md).
 */
export class Registration {
  /** What the sign-up endpoint answers once an account exists. */
  static readonly ClosedMessage = "Registration is closed: this Hangar already has its account.";

  private readonly db: BetterSQLite3Database<AnyRelations>;

  constructor(db: BetterSQLite3Database<AnyRelations>) {
    this.db = db;
  }

  /** `true` until the first account is created. */
  async isOpen(): Promise<boolean> {
    return (await this.db.$count(user)) === 0;
  }
}
