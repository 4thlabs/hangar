import { createFileRoute } from "@tanstack/react-router";
import { StorePage } from "#modules/store/components/store-page.tsx";
import { validateStoreSearch } from "#modules/store/helpers/store-search.ts";

/** `/store`, the store's apps, filtered by its search. */
export const Route = createFileRoute("/_app/store")({
  validateSearch: validateStoreSearch,
  staticData: { searchable: true },
  component: StorePage,
});
