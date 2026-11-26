import { createFileRoute } from "@tanstack/react-router";
import { NewAppPage } from "#modules/store/components/new-app-page.tsx";

// `store_`: a page of its own beside the store at `/store`, not a child rendered inside it.
export const Route = createFileRoute("/_app/store_/new")({
  component: NewAppPage,
});
