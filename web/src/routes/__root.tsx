import { createRootRouteWithContext } from "@tanstack/react-router";
import type { RouterContext } from "#app/router.ts";

// The root renders its child alone: the app's frame is `_app`'s, and `/login` stands outside it.
export const Route = createRootRouteWithContext<RouterContext>()({});
