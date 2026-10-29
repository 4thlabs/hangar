import type { ComposeProjectSummary } from "#libs/docker";
import { AppInstallation } from "#modules/apps/installation.ts";
import {
  APP_STATUSES,
  type AppSortColumn,
  type AppsSearch,
  type AppsSort,
  type AppUpdate,
} from "#modules/apps/search-codec.ts";
import { searchByName } from "#modules/common/search.ts";
import { TableSort } from "#modules/common/table-sort.ts";

/** What each sortable column compares on. Status sorts by severity, i.e. `APP_STATUSES` order. */
const sortValue: Record<AppSortColumn, (project: ComposeProjectSummary) => number | string> = {
  name: project => project.name,
  // The sentinel sorts after any real name, so apps in no category group at the bottom ascending.
  category: project => project.category?.name ?? "\uffff",
  status: project => APP_STATUSES.indexOf(project.status),
  services: project => project.serviceCount,
  containers: project => project.containerIds.length,
  unhealthy: project => project.unhealthyCount,
};

/** Which side of the update filter a project falls on; not checked yet counts as up to date, like the row badge. */
export const updateState = (project: ComposeProjectSummary): AppUpdate =>
  project.updateAvailable ? "available" : "current";

/**
 * Narrows the app list to the selected categories, statuses and update states, then to the query.
 * An empty list means no filter on that dimension; a stack in no `hangar.yml` category only shows up unfiltered.
 * An app that is not installed has no status nor image, so a status or an update filter leaves it out.
 */
export function filterProjects(
  projects: ComposeProjectSummary[],
  { q, status, category, update, sort }: AppsSearch,
): ComposeProjectSummary[] {
  const classified =
    category.length === 0
      ? projects
      : projects.filter(project => project.category && category.includes(project.category.name));

  const matching =
    status.length === 0
      ? classified
      : classified.filter(project => AppInstallation.isInstalled(project) && status.includes(project.status));

  const fresh =
    update.length === 0
      ? matching
      : matching.filter(project => AppInstallation.isInstalled(project) && update.includes(updateState(project)));

  const found = searchByName(q, fresh);

  // An explicit column wins over relevance: the user asked for that order.
  return sort ? TableSort.apply(found, sort, sortValue[sort.column]) : found;
}

/** The sort a header click moves to; see `TableSort.next`. */
export function nextSort(current: AppsSort, column: AppSortColumn): AppsSort {
  return TableSort.next(current, column);
}
