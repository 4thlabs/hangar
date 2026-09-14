import { searchByName } from "#app/search.ts";
import { APP_STATUSES, type AppSortColumn, type AppsSearch, type AppsSort } from "#app/search-codecs.ts";
import type { ComposeProjectSummary } from "#libs/docker";

/** What each sortable column compares on. Status sorts by severity, i.e. `APP_STATUSES` order. */
const sortValue: Record<AppSortColumn, (project: ComposeProjectSummary) => number | string> = {
  name: project => project.name,
  status: project => APP_STATUSES.indexOf(project.status),
  services: project => project.serviceCount,
  containers: project => project.containerCount,
  unhealthy: project => project.unhealthyCount,
};

/**
 * Orders by the chosen column, always breaking ties on the name: without a tie-break, apps
 * with equal counts would swap places on every 5s poll.
 */
function sortProjects(projects: ComposeProjectSummary[], { column, descending }: NonNullable<AppsSort>) {
  const value = sortValue[column];

  return [...projects].sort((left, right) => {
    const [a, b] = [value(left), value(right)];
    const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

    return (descending ? -order : order) || left.name.localeCompare(right.name);
  });
}

/**
 * Narrows the app list to the selected statuses, then to the search query.
 * An empty `status` list means no status filter, so the unfiltered view needs no special case.
 * @param projects The current snapshot's projects
 * @param search The `/apps` search params
 */
export function filterProjects(
  projects: ComposeProjectSummary[],
  { q, status, sort }: AppsSearch,
): ComposeProjectSummary[] {
  const matching = status.length === 0 ? projects : projects.filter(project => status.includes(project.status));

  const found = searchByName(q, matching);

  // An explicit column wins over relevance: the user asked for that order.
  return sort ? sortProjects(found, sort) : found;
}

/**
 * The sort a header click should move to: unsorted, ascending, descending, then back to
 * unsorted, so there is always a way back to relevance ordering while searching.
 */
export function nextSort(current: AppsSort, column: AppSortColumn): AppsSort {
  if (current?.column !== column) return { column, descending: false };

  return current.descending ? null : { column, descending: true };
}

/** How many projects carry each status, for the counts shown beside each checkbox. */
export function statusCounts(projects: ComposeProjectSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const project of projects) counts[project.status] = (counts[project.status] ?? 0) + 1;

  return counts;
}
