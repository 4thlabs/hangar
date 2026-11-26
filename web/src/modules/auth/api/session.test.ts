import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSessionQueryKey } from "#libs/api";
import { Session } from "./session.ts";

/** A router at `pathname`, whose navigations are recorded. */
function routerAt(pathname: string) {
  return { state: { location: { pathname } }, navigate: vi.fn(async () => {}) };
}

/** A query client that asks no query again, so that a failure is the test's at once. */
function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Answers `GET /api/auth/session` with `response`. */
function answerSession(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Session.require", () => {
  it("gives the signed-in user", async () => {
    answerSession(() => Response.json({ name: "Ana", email: "ana@example.com" }));

    await expect(new Session(queryClient()).require()).resolves.toEqual({ name: "Ana", email: "ana@example.com" });
  });

  it("sends a page whose session the server refuses with a 401 to /login", async () => {
    answerSession(() =>
      Response.json(
        { type: "about:blank", title: "Unauthorized", status: 401, detail: "no session" },
        { status: 401, headers: { "Content-Type": "application/problem+json" } },
      ),
    );

    const refusal = await new Session(queryClient()).require().catch((error: unknown) => error);

    expect(isRedirect(refusal) && refusal.options.to).toBe("/login");
  });
});

describe("Session.signedOut", () => {
  it("forgets the session and goes to /login", () => {
    const client = queryClient();
    const router = routerAt("/apps");

    client.setQueryData(getAuthSessionQueryKey(), { name: "Ana", email: "ana@example.com" });
    new Session(client).signedOut(router);

    expect(client.getQueryData(getAuthSessionQueryKey())).toBeUndefined();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("stays on /login, where a wrong password is a 401 too", () => {
    const router = routerAt("/login");

    new Session(queryClient()).signedOut(router);

    expect(router.navigate).not.toHaveBeenCalled();
  });
});
