import { createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { AppLayout } from "#modules/common/components/app-layout.tsx";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";
import { PendingPage } from "#modules/common/components/pending-page.tsx";

/**
 * The page's routes, the paths of the Waku version's `pages/`. The frame of `(app)/_layout.tsx` is `app`, a route
 * with no path of its own; each section is a pending page until the issue of its area moves it here.
 */
export class Routes {
  static readonly root = createRootRoute();

  static readonly app = createRoute({
    getParentRoute: () => Routes.root,
    id: "app",
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
    Routes.app.addChildren([Routes.dashboard, Routes.apps, Routes.cluster, Routes.store, Routes.settings]),
  ]);

  /** The router of the page, on the browser's history unless `history` is given, as a test's in memory. */
  static createRouter(history?: RouterHistory) {
    return createRouter({
      routeTree: Routes.tree,
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
