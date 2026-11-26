import { createFileRoute } from "@tanstack/react-router";
import { AppsPage } from "#modules/apps/components/apps-page.tsx";
import { validateAppsSearch } from "#modules/apps/helpers/apps-search.ts";

/** `/apps`, the installed apps, filtered by its search. */
export const Route = createFileRoute("/_app/apps")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  component: AppsPage,
});
