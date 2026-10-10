import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRelations, migrateDb } from "#libs/db";
import { createAuth } from "./auth.ts";
import { Sessions } from "./session.ts";

// Only loads under the `react-server` condition; every test here passes its request explicitly.
vi.mock("waku/router/server", () => ({ unstable_getRequest: vi.fn(), unstable_redirect: vi.fn() }));

// A real better-auth on an in-memory SQLite: what is under test is whether a check reaches the
// database, which a stubbed `auth.api` could not tell.
const database = drizzle({ client: migrateDb(":memory:").$client, relations: { ...authRelations } });
const auth = createAuth(database);
const sessions = new Sessions(auth);

/** Turns `Set-Cookie` values into the `Cookie` header a browser would send back. */
const cookieHeader = (setCookies: string[]) => setCookies.map(cookie => cookie.split(";")[0]).join("; ");

const requestWith = (cookie: string) => new Request("http://localhost/", { headers: { Cookie: cookie } });

/** Signs a fresh account up and returns the cookies the browser gets back. */
async function signUp() {
  const { headers } = await auth.api.signUpEmail({
    body: { name: "Alice", email: "alice@example.com", password: "correct horse battery" },
    returnHeaders: true,
  });

  return headers.getSetCookie();
}

describe("Sessions", () => {
  beforeEach(() => {
    database.run(sql`delete from session`);
    database.run(sql`delete from account`);
    database.run(sql`delete from user`);
  });

  it("answers from the cookie cache without reading the session table", async () => {
    const cookies = await signUp();

    database.run(sql`delete from session`);

    expect(await sessions.get(requestWith(cookieHeader(cookies)))).toMatchObject({
      user: { email: "alice@example.com" },
    });
  });

  it("falls back to the database once the cookie cache is gone", async () => {
    const cookies = await signUp();
    const sessionTokenOnly = cookies.filter(cookie => cookie.includes("session_token"));

    database.run(sql`delete from session`);

    expect(await sessions.get(requestWith(cookieHeader(sessionTokenOnly)))).toBeNull();
  });

  it("renews the cookie cache of a request that lost it", async () => {
    const cookies = await signUp();
    const sessionTokenOnly = cookies.filter(cookie => cookie.includes("session_token"));

    const renewedCookies = await sessions.renewedCookies(requestWith(cookieHeader(sessionTokenOnly)));

    expect(renewedCookies.some(cookie => cookie.includes("session_data"))).toBe(true);
  });

  it("renews nothing while the cookie cache is valid", async () => {
    const cookies = await signUp();

    expect(await sessions.renewedCookies(requestWith(cookieHeader(cookies)))).toEqual([]);
  });
});
