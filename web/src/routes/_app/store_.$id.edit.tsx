import { createFileRoute } from "@tanstack/react-router";
import { EditAppPage } from "#modules/store/components/edit-app-page.tsx";

/**
 * `/store/$id/edit`, the editor of an app of the store. `store_`: a page of its own beside `/store`, not a child
 * rendered inside it.
 */
export const Route = createFileRoute("/_app/store_/$id/edit")({
  component: EditAppPage,
});
