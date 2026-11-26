import { createFileRoute } from "@tanstack/react-router";
import { validateAppsSearch } from "#modules/apps/apps-search.ts";
import { AppsPage } from "#modules/apps/components/apps-page.tsx";

export const Route = createFileRoute("/_app/apps")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  component: AppsPage,
});
