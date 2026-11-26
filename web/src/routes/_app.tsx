import { createFileRoute } from "@tanstack/react-router";
import { NotFoundPage } from "#routes/_app/-not-found-page.tsx";
import { AppErrorPage } from "#routes/-shell/app-error-page.tsx";
import { AppLayout } from "#routes/-shell/app-layout.tsx";

/**
 * The app's frame, the Waku version's `(app)/_layout.tsx`: a route with no path of its own, around every page but
 * `/login`, which needs a session as the Waku version's does.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    await context.session.require();
  },
  component: AppLayout,
  // A session the server could not read, or a page that failed with no `errorComponent` of its own.
  errorComponent: AppErrorPage,
  // What a page inside the frame throws with `notFound()`; a path no page has is `$.tsx`'s.
  notFoundComponent: NotFoundPage,
});
