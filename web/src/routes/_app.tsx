import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "#modules/common/components/app-layout.tsx";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";

// The frame of the Waku version's `(app)/_layout.tsx`: a route with no path of its own, around every page but
// `/login`, which needs a session as the Waku version's does.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    await context.session.require();
  },
  component: AppLayout,
  // What a page inside the frame throws with `notFound()`; a path no page has is `$.tsx`'s.
  notFoundComponent: NotFoundPage,
});
