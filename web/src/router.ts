import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import type { Session } from "#modules/auth/api/session.ts";
import { routeTree } from "#routeTree.gen.ts";

/** What every route reads: the page's query client, and the session it keeps. */
export type RouterContext = { queryClient: QueryClient; session: Session };

/**
 * The router of the page, on the routes of `src/routes/`, which hands `context` to every route, on the browser's
 * history unless `history` is given, as a test's in memory. `createPage` creates it.
 */
export function createPageRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history ? { history } : {}),
    // A `notFound()` a page throws is shown by the nearest route above it with a `notFoundComponent`: the app's frame,
    // with its navigation. A path no page has is `_app/$`'s.
    notFoundMode: "fuzzy",
    // A link hovered or focused loads its page's code ahead, and what the page's loader reads once it has one. Query
    // alone decides whether that is fresh: the router keeps no copy of its own (ADR 0002, rule 15).
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createPageRouter>;
  }

  /** What a route says of itself to the frame around it. */
  interface StaticDataRouteOption {
    /** Whether the page reads a `?q=`, which the navbar's search field then drives. */
    searchable?: boolean;
  }
}
