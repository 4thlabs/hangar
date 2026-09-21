import { searchByName } from "#app/search.ts";
import {
  APP_STATUSES,
  type AppSortColumn,
  type AppsSearch,
  type AppsSort,
  type AppUpdate,
} from "#app/search-codecs.ts";
import type { ComposeProjectSummary } from "#libs/docker";

/** What each sortable column compares on. Status sorts by severity, i.e. `APP_STATUSES` order. */
const sortValue: Record<AppSortColumn, (project: ComposeProjectSummary) => number | string> = {
  name: project => project.name,
  // The sentinel sorts after any real name, so apps in no category group at the bottom ascending.
  category: project => project.category?.name ?? "\uffff",
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
 * Which side of the update filter a project falls on. `updateAvailable` is `undefined` until the
 * version check has run, and an app nobody has looked at yet counts as up to date — the same call
 * the row badge already makes.
 */
export const updateState = (project: ComposeProjectSummary): AppUpdate =>
  project.updateAvailable ? "available" : "current";

/**
 * Narrows the app list to the selected categories, statuses and update states, then to the query.
 * An empty list means no filter on that dimension, so the unfiltered view needs no special case.
 * A stack missing from every `hangar.yml` category can only show up unfiltered.
 * @param projects The current snapshot's projects
 * @param search The `/apps` search params
 */
export function filterProjects(
  projects: ComposeProjectSummary[],
  { q, status, category, update, sort }: AppsSearch,
): ComposeProjectSummary[] {
  const classified =
    category.length === 0
      ? projects
      : projects.filter(project => project.category && category.includes(project.category.name));

  const matching = status.length === 0 ? classified : classified.filter(project => status.includes(project.status));

  const fresh = update.length === 0 ? matching : matching.filter(project => update.includes(updateState(project)));

  const found = searchByName(q, fresh);

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

/**
 * How many projects carry each value, for the counts shown beside each checkbox.
 * A project the key does not apply to — an app in no category — counts towards nothing.
 */
export function countBy(
  projects: ComposeProjectSummary[],
  key: (project: ComposeProjectSummary) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const project of projects) {
    const value = key(project);
    if (value !== undefined) counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}
