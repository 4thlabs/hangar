import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getAuthSessionQueryKey, getAuthSessionQueryOptions, QueryClients, type SessionUser } from "#libs/api";

/** What the guard needs of the router: where it is, and how to go elsewhere. */
type GuardedRouter = {
  state: { location: { pathname: string } };
  navigate: (options: { to: "/login" }) => Promise<void>;
};

/**
 * The session the signed-in pages need, as the Waku version's `sessions.require()`: a page without one goes to
 * `/login`, at its load and whenever the server answers 401 after.
 */
export class SessionGuard {
  /** The path of the sign-in page. */
  static readonly LoginPath = "/login";

  /**
   * How long the session the query client keeps is taken as current. A navigation past it asks the server again,
   * in the background, which renews a session a day old: one in use does not expire.
   */
  private static readonly Freshness = 5 * 60 * 1000;

  /** The signed-in user, kept by the query client; a redirect to `/login` without a session. */
  static async require(queryClient: QueryClient): Promise<SessionUser> {
    try {
      return await queryClient.ensureQueryData({
        ...getAuthSessionQueryOptions({ query: { staleTime: SessionGuard.Freshness } }),
        revalidateIfStale: true,
      });
    } catch (error) {
      if (QueryClients.isUnauthorized(error)) {
        throw redirect({ to: SessionGuard.LoginPath });
      }

      throw error;
    }
  }

  /** Forgets the session the server refused, and goes to `/login` unless the page is there already. */
  static signedOut(router: GuardedRouter, queryClient: QueryClient): void {
    queryClient.removeQueries({ queryKey: getAuthSessionQueryKey() });

    if (router.state.location.pathname !== SessionGuard.LoginPath) {
      void router.navigate({ to: SessionGuard.LoginPath });
    }
  }
}
