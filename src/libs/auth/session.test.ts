import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRelations, migrateDb } from "#libs/db";
import { createAuth } from "./auth.ts";
import { Sessions } from "./session.ts";

const mocks = vi.hoisted(() => ({ getRequest: vi.fn(), redirect: vi.fn() }));

// Only loads under the `react-server` condition; the request and the redirect are Waku's.
vi.mock("waku/router/server", () => ({ unstable_getRequest: mocks.getRequest, unstable_redirect: mocks.redirect }));

// A real better-auth on an in-memory SQLite: `createAuth` takes its database by injection, so the
// session checks run against real rows instead of a stubbed `auth.api`.
const database = drizzle({ client: migrateDb(":memory:").$client, relations: { ...authRelations } });
const auth = createAuth(database);
const sessions = new Sessions(auth);

/** Turns `Set-Cookie` values into the `Cookie` header a browser would send back. */
const cookieHeader = (setCookies: string[]) => setCookies.map(cookie => cookie.split(";")[0]).join("; ");

const requestWith = (cookie: string) => new Request("http://localhost/", { headers: { Cookie: cookie } });

/** Signs a fresh account up and returns the request its browser would send next. */
async function signUp() {
  const { headers } = await auth.api.signUpEmail({
    body: { name: "Alice", email: "alice@example.com", password: "correct horse battery" },
    returnHeaders: true,
  });

  return requestWith(cookieHeader(headers.getSetCookie()));
}

describe("Sessions", () => {
  beforeEach(() => {
    mocks.getRequest.mockReset();
    mocks.redirect.mockReset();
    database.run(sql`delete from session`);
    database.run(sql`delete from account`);
    database.run(sql`delete from user`);
  });

  it("finds the session of a signed-in request", async () => {
    const request = await signUp();

    expect(await sessions.get(request)).toMatchObject({ user: { email: "alice@example.com" } });
  });

  it("checks the database on every call, so a deleted session is gone at once", async () => {
    const request = await signUp();

    database.run(sql`delete from session`);

    expect(await sessions.get(request)).toBeNull();
  });

  it("checks the request being handled when none is given", async () => {
    mocks.getRequest.mockReturnValue(await signUp());

    expect(await sessions.get()).toMatchObject({ user: { email: "alice@example.com" } });
  });

  it("redirects an anonymous request to the login page", async () => {
    mocks.getRequest.mockReturnValue(new Request("http://localhost/"));

    await sessions.require();

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("hands a signed-in request its session without redirecting", async () => {
    mocks.getRequest.mockReturnValue(await signUp());

    expect(await sessions.require()).toMatchObject({ user: { email: "alice@example.com" } });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
