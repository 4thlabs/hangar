import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { AppsSearchParams } from "#modules/apps/apps-search.ts";
import { AppDetailPage } from "#modules/apps/components/app-detail-page.tsx";
import { AppsPage } from "#modules/apps/components/apps-page.tsx";
import { LoginPage } from "#modules/auth/components/login-page.tsx";
import { SessionGuard } from "#modules/auth/session-guard.ts";
import { AppLayout } from "#modules/common/components/app-layout.tsx";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";
import { PendingPage } from "#modules/common/components/pending-page.tsx";
import { SettingsPage } from "#modules/settings/components/settings-page.tsx";
import { EditAppPage } from "#modules/store/components/edit-app-page.tsx";
import { NewAppPage } from "#modules/store/components/new-app-page.tsx";
import { StorePage } from "#modules/store/components/store-page.tsx";
import { StoreSearchParams } from "#modules/store/store-search.ts";
import { DashboardPage } from "#modules/widgets/components/dashboard-page.tsx";

/** What every route reads: the page's query client, which keeps the session. */
type RouterContext = { queryClient: QueryClient };

/**
 * The search of `/login`: why a sign-in through the provider came back, if it did. Any text, which
 * `SignInMessages.refusal` reads as a `SignInRefusal` or none.
 */
type LoginSearch = { error?: string };

/**
 * The page's routes, the paths of the Waku version's `pages/`. The frame of `(app)/_layout.tsx` is `app`, a route
 * with no path of its own, which needs a session as the Waku version's does; `/login` stands outside it. A section not
 * moved here yet is a pending page until the issue of its area moves it.
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

  static readonly dashboard = createRoute({ getParentRoute: () => Routes.app, path: "/", component: DashboardPage });

  static readonly apps = createRoute({
    getParentRoute: () => Routes.app,
    path: "/apps",
    component: AppsPage,
    validateSearch: AppsSearchParams.validate,
    staticData: { searchable: true },
  });

  static readonly appDetail = createRoute({
    getParentRoute: () => Routes.app,
    path: "/apps/$project",
    component: AppDetailPage,
  });

  static readonly cluster = createRoute({ getParentRoute: () => Routes.app, path: "/cluster", component: PendingPage });

  static readonly store = createRoute({
    getParentRoute: () => Routes.app,
    path: "/store",
    component: StorePage,
    validateSearch: StoreSearchParams.validate,
    staticData: { searchable: true },
  });

  static readonly newApp = createRoute({ getParentRoute: () => Routes.app, path: "/store/new", component: NewAppPage });

  static readonly editApp = createRoute({
    getParentRoute: () => Routes.app,
    path: "/store/$id/edit",
    component: EditAppPage,
  });

  static readonly settings = createRoute({
    getParentRoute: () => Routes.app,
    path: "/settings",
    component: SettingsPage,
  });

  static readonly tree = Routes.root.addChildren([
    Routes.login,
    Routes.app.addChildren([
      Routes.dashboard,
      Routes.apps,
      Routes.appDetail,
      Routes.cluster,
      Routes.store,
      Routes.newApp,
      Routes.editApp,
      Routes.settings,
    ]),
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

  /** What a route says of itself to the frame around it. */
  interface StaticDataRouteOption {
    /** Whether the page reads a `?q=`, which the navbar's search field then drives. */
    searchable?: boolean;
  }
}
