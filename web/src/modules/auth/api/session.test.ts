import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { getAuthSessionQueryKey } from "#libs/api";
import { getAuthSessionMockHandler } from "#libs/api/mock";
import { network, problem, unauthorized } from "#mock/network.ts";
import { Session } from "./session.ts";

/** A router at `pathname`, whose navigations are recorded. */
function routerAt(pathname: string) {
  return { state: { location: { pathname } }, navigate: vi.fn(async () => {}) };
}

/** A query client that asks no query again, so that a failure is the test's at once. */
function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("Session.require", () => {
  it("gives the signed-in user", async () => {
    network.use(getAuthSessionMockHandler({ name: "Ana", email: "ana@example.com" }));

    await expect(new Session(queryClient()).require()).resolves.toEqual({ name: "Ana", email: "ana@example.com" });
  });

  it("sends a page whose session the server refuses with a 401 to /login", async () => {
    network.use(
      getAuthSessionMockHandler(() => {
        throw unauthorized();
      }),
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

describe("Session.forgetFailure", () => {
  it("forgets a read that failed, so that the session is asked for again", async () => {
    const client = queryClient();
    const session = new Session(client);

    network.use(
      getAuthSessionMockHandler(() => {
        throw problem(500, "the database is locked");
      }),
    );

    await expect(session.require()).rejects.toMatchObject({ status: 500 });
    session.forgetFailure();

    expect(client.getQueryState(getAuthSessionQueryKey())).toBeUndefined();

    network.use(getAuthSessionMockHandler({ name: "Ana", email: "ana@example.com" }));

    await expect(session.require()).resolves.toEqual({ name: "Ana", email: "ana@example.com" });
  });

  it("keeps a session that was read", () => {
    const client = queryClient();

    client.setQueryData(getAuthSessionQueryKey(), { name: "Ana", email: "ana@example.com" });
    new Session(client).forgetFailure();

    expect(client.getQueryData(getAuthSessionQueryKey())).toEqual({ name: "Ana", email: "ana@example.com" });
  });
});
