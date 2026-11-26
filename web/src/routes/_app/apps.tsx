import { createFileRoute } from "@tanstack/react-router";
import { validateAppsSearch } from "#modules/apps/apps-search.ts";
import { AppsPage } from "#modules/apps/components/apps-page.tsx";

/** `/apps`, the installed apps, filtered by its search. */
export const Route = createFileRoute("/_app/apps")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  component: AppsPage,
});
