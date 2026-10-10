import { Hono } from "hono/tiny";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sessionCookies from "./session-cookies.ts";

const mocks = vi.hoisted(() => ({ renewedCookies: vi.fn() }));

vi.mock("#libs/auth/server", () => ({ sessions: { renewedCookies: mocks.renewedCookies } }));

const RENEWED_CACHE = "better-auth.session_data=renewed; Path=/; HttpOnly";

/** An app answering every path with an empty page, with the middleware in front. */
function request(path: string, headers: Record<string, string> = {}) {
  const hono = new Hono();

  hono.use(sessionCookies());
  hono.all("*", () => new Response("page"));

  return hono.request(path, { headers });
}

describe("session cookies middleware", () => {
  beforeEach(() => {
    mocks.renewedCookies.mockReset();
    mocks.renewedCookies.mockResolvedValue([RENEWED_CACHE]);
  });

  it("puts the renewed session cookies on the response", async () => {
    const response = await request("/", { Cookie: "better-auth.session_token=token" });

    expect(response.headers.getSetCookie()).toEqual([RENEWED_CACHE]);
  });

  it("leaves better-auth's own routes to set their cookies", async () => {
    const response = await request("/api/auth/sign-out", { Cookie: "better-auth.session_token=token" });

    expect(mocks.renewedCookies).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("skips a request carrying no cookie", async () => {
    await request("/");

    expect(mocks.renewedCookies).not.toHaveBeenCalled();
  });
});
