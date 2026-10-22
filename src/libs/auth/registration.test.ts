import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { authRelations, migrateDb, user } from "#libs/db";
import { createAuth } from "./auth.ts";
import { Registration } from "./registration.ts";

// A real better-auth on an in-memory SQLite, as in `session.test.ts`: the refusal comes from its own hook.
const database = drizzle({ client: migrateDb(":memory:").$client, relations: { ...authRelations } });
const auth = createAuth(database);
const registration = new Registration(database);

const signUp = (email: string) =>
  auth.api.signUpEmail({ body: { name: "Alice", email, password: "correct horse battery" } });

describe("Registration", () => {
  beforeEach(() => {
    database.run(sql`delete from session`);
    database.run(sql`delete from account`);
    database.run(sql`delete from user`);
  });

  it("creates the first account", async () => {
    await expect(registration.isOpen()).resolves.toBe(true);

    await signUp("alice@example.com");

    await expect(registration.isOpen()).resolves.toBe(false);
  });

  it("refuses every account after the first, and creates none", async () => {
    await signUp("alice@example.com");

    await expect(signUp("mallory@example.com")).rejects.toMatchObject({
      status: "FORBIDDEN",
      message: Registration.ClosedMessage,
    });

    expect(await database.$count(user)).toBe(1);
  });
});
