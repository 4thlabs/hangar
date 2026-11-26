import { createFileRoute } from "@tanstack/react-router";
import { NotFoundPage } from "#modules/common/components/not-found-page.tsx";

/**
 * Any path no page has, as `/nowhere` or `/apps/alpha/nowhere`: the not-found page in the app's frame, behind its
 * session. Without it the root would show the router's bare one, as `_app`, a route with no path of its own, matches
 * no path by itself.
 */
export const Route = createFileRoute("/_app/$")({
  component: NotFoundPage,
});
