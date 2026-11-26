import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getAuthSessionQueryKey, getAuthSessionQueryOptions, isUnauthorized, type SessionUser } from "#libs/api";

/** The path of the sign-in page. */
export const loginPath = "/login";

/**
 * How long the session the query client keeps is taken as current. A navigation past it asks the server again, in the
 * background, which renews a session a day old: one in use does not expire.
 */
const freshness = 5 * 60 * 1000;

/** What the session needs of the router: where it is, and how to go elsewhere. */
type SessionRouter = {
  state: { location: { pathname: string } };
  navigate: (options: { to: typeof loginPath }) => Promise<void>;
};

/**
 * The session the signed-in pages need, kept by the page's query client, as the Waku version's `sessions.require()`:
 * a page without one goes to `/login`, at its load and whenever the server answers 401 after. `createPage` creates the
 * one instance, which the routes read from the router's context.
 */
export class Session {
  readonly #queryClient: QueryClient;

  constructor(queryClient: QueryClient) {
    this.#queryClient = queryClient;
  }

  /** The signed-in user; a redirect to `/login` without a session. */
  async require(): Promise<SessionUser> {
    try {
      return await this.#queryClient.ensureQueryData({
        ...getAuthSessionQueryOptions({ query: { staleTime: freshness } }),
        revalidateIfStale: true,
      });
    } catch (error) {
      if (isUnauthorized(error)) {
        throw redirect({ to: loginPath });
      }

      throw error;
    }
  }

  /** Forgets the session the server refused, and goes to `/login` unless the page is there already. */
  signedOut(router: SessionRouter): void {
    this.#queryClient.removeQueries({ queryKey: getAuthSessionQueryKey() });

    if (router.state.location.pathname !== loginPath) {
      void router.navigate({ to: loginPath });
    }
  }
}
