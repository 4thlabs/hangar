import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { validateAppsSearch } from "#modules/apps/apps-search.ts";
import { AppDetailPage } from "#modules/apps/components/app-detail-page.tsx";
import { AppsPage } from "#modules/apps/components/apps-page.tsx";
import { loginPath, type Session } from "#modules/auth/api/session.ts";
import { LoginPage } from "#modules/auth/components/login-page.tsx";
import { AppLayout } from "#modules/common/components/app-layout.tsx";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";
import { PendingPage } from "#modules/common/components/pending-page.tsx";
import { SettingsPage } from "#modules/settings/components/settings-page.tsx";
import { EditAppPage } from "#modules/store/components/edit-app-page.tsx";
import { NewAppPage } from "#modules/store/components/new-app-page.tsx";
import { StorePage } from "#modules/store/components/store-page.tsx";
import { StoreSearchParams } from "#modules/store/store-search.ts";
import { DashboardPage } from "#modules/widgets/components/dashboard-page.tsx";

/** What every route reads: the page's query client, and the session it keeps. */
export type RouterContext = { queryClient: QueryClient; session: Session };

/**
 * The search of `/login`: why a sign-in through the provider came back, if it did. Any text, which
 * `isSignInRefusal` reads as a `SignInRefusal` or none.
 */
type LoginSearch = { error?: string };

// The page's routes, the paths of the Waku version's `pages/`. The frame of `(app)/_layout.tsx` is `app`, a route with
// no path of its own, which needs a session as the Waku version's does; `/login` stands outside it. A section not moved
// here yet is a pending page until the issue of its area moves it.

const rootRoute = createRootRouteWithContext<RouterContext>()();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: loginPath,
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.error === "string" ? { error: search.error } : {},
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    await context.session.require();
  },
  component: AppLayout,
  notFoundComponent: NotFoundPage,
});

const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: DashboardPage });

const appsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps",
  component: AppsPage,
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
});

const appDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/apps/$project",
  component: AppDetailPage,
});

const clusterRoute = createRoute({ getParentRoute: () => appRoute, path: "/cluster", component: PendingPage });

const storeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/store",
  component: StorePage,
  validateSearch: StoreSearchParams.validate,
  staticData: { searchable: true },
});

const newAppRoute = createRoute({ getParentRoute: () => appRoute, path: "/store/new", component: NewAppPage });

const editAppRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/store/$id/edit",
  component: EditAppPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    appsRoute,
    appDetailRoute,
    clusterRoute,
    storeRoute,
    newAppRoute,
    editAppRoute,
    settingsRoute,
  ]),
]);

/**
 * The router of the page, which hands `context` to every route, on the browser's history unless `history` is given,
 * as a test's in memory. `createPage` creates it.
 */
export function createPageRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history ? { history } : {}),
    // A path no route has is shown in the frame of the deepest route it starts with: the app's, with its navigation.
    notFoundMode: "fuzzy",
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
