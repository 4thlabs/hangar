import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { getAuthSessionQueryKey } from "#libs/api";
import { SessionGuard } from "./session-guard.ts";

/** A router at `pathname`, whose navigations are recorded. */
function routerAt(pathname: string) {
  return { state: { location: { pathname } }, navigate: vi.fn(async () => {}) };
}

describe("SessionGuard.signedOut", () => {
  it("forgets the session and goes to /login", () => {
    const queryClient = new QueryClient();
    const router = routerAt("/apps");

    queryClient.setQueryData(getAuthSessionQueryKey(), { name: "Ana", email: "ana@example.com" });
    SessionGuard.signedOut(router, queryClient);

    expect(queryClient.getQueryData(getAuthSessionQueryKey())).toBeUndefined();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("stays on /login, where a wrong password is a 401 too", () => {
    const router = routerAt("/login");

    SessionGuard.signedOut(router, new QueryClient());

    expect(router.navigate).not.toHaveBeenCalled();
  });
});
