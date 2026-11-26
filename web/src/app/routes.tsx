import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { LoginPage } from "#modules/auth/components/login-page.tsx";
import { SessionGuard } from "#modules/auth/session-guard.ts";
import type { SignInRefusal } from "#modules/auth/sign-in-messages.ts";
import { AppLayout } from "#modules/common/components/app-layout.tsx";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";
import { PendingPage } from "#modules/common/components/pending-page.tsx";

/** What every route reads: the page's query client, which keeps the session. */
type RouterContext = { queryClient: QueryClient };

/** The search of `/login`: why a sign-in through the provider came back, if it did. */
type LoginSearch = { error?: SignInRefusal | string };

/**
 * The page's routes, the paths of the Waku version's `pages/`. The frame of `(app)/_layout.tsx` is `app`, a route
 * with no path of its own, which needs a session as the Waku version's does; `/login` stands outside it. Each section
 * is a pending page until the issue of its area moves it here.
 */
export class Routes {
  static readonly root = createRootRouteWithContext<RouterContext>()();

  static readonly login = createRoute({
    getParentRoute: () => Routes.root,
    path: SessionGuard.LoginPath,
    component: LoginPage,
    validateSearch: (search: Record<string, unknown>): LoginSearch =>
      typeof search.error === "string" ? { error: search.error } : {},
  });

  static readonly app = createRoute({
    getParentRoute: () => Routes.root,
    id: "app",
    beforeLoad: async ({ context }) => {
      await SessionGuard.require(context.queryClient);
    },
    component: AppLayout,
    notFoundComponent: NotFoundPage,
  });

  static readonly dashboard = createRoute({ getParentRoute: () => Routes.app, path: "/", component: PendingPage });

  static readonly apps = createRoute({ getParentRoute: () => Routes.app, path: "/apps", component: PendingPage });

  static readonly cluster = createRoute({ getParentRoute: () => Routes.app, path: "/cluster", component: PendingPage });

  static readonly store = createRoute({ getParentRoute: () => Routes.app, path: "/store", component: PendingPage });

  static readonly settings = createRoute({
    getParentRoute: () => Routes.app,
    path: "/settings",
    component: PendingPage,
  });

  static readonly tree = Routes.root.addChildren([
    Routes.login,
    Routes.app.addChildren([Routes.dashboard, Routes.apps, Routes.cluster, Routes.store, Routes.settings]),
  ]);

  /**
   * The router of the page, on `queryClient`, on the browser's history unless `history` is given, as a test's in
   * memory.
   */
  static createRouter(queryClient: QueryClient, history?: RouterHistory) {
    return createRouter({
      routeTree: Routes.tree,
      context: { queryClient },
      ...(history ? { history } : {}),
      // A path no route has is shown in the frame of the deepest route it starts with: the app's, with its
      // navigation.
      notFoundMode: "fuzzy",
    });
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof Routes.createRouter>;
  }
}
