import { createFileRoute } from "@tanstack/react-router";
import { NewAppPage } from "#modules/store/components/new-app-page.tsx";

/**
 * `/store/new`, a new app of the store. `store_`: a page of its own beside `/store`, not a child rendered inside it.
 */
export const Route = createFileRoute("/_app/store_/new")({
  component: NewAppPage,
});
