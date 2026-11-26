import type { ProjectStatus, ProjectSummary } from "#libs/api";
import { AppsSearchParams, type AppSortColumn, type AppsSort, type AppUpdate } from "#modules/apps/apps-search.ts";
import { NameSearch } from "#modules/common/search.ts";
import { TableSort } from "#modules/common/table-sort.ts";

/** What narrows the apps' table: the query, the statuses, the categories and the sides of the update filter ticked, and
 * the order. */
export type ProjectQuery = {
  q: string;
  statuses: readonly ProjectStatus[];
  categories: readonly string[];
  updates: readonly AppUpdate[];
  sort: AppsSort;
};

/** Narrows and orders the apps of `/apps`, as the Waku version does. */
export class ProjectFilter {
  /** What each sortable column compares on. The status sorts by the filter menu's order. */
  private static readonly SortValue: Record<AppSortColumn, (project: ProjectSummary) => number | string> = {
    name: project => project.name,
    // After any real name, so that the apps of no category group at the bottom, ascending.
    category: project => project.category?.name ?? "￿",
    status: project => AppsSearchParams.Statuses.indexOf(project.status),
    services: project => project.serviceCount,
    containers: project => project.containerIds.length,
    unhealthy: project => project.unhealthyCount,
  };

  /**
   * The apps of the categories, statuses and sides of the update filter ticked, none ticked keeping all of them, then
   * those whose name matches the query, by relevance; in the order of a column when one is asked for. An app in no
   * category of `hangar.yml` shows only with no category ticked.
   */
  static apply(
    projects: readonly ProjectSummary[],
    { q, statuses, categories, updates, sort }: ProjectQuery,
  ): ProjectSummary[] {
    const classified =
      categories.length === 0
        ? projects
        : projects.filter(project => project.category && categories.includes(project.category.name));

    const matching =
      statuses.length === 0 ? classified : classified.filter(project => statuses.includes(project.status));

    const updating =
      updates.length === 0 ? matching : matching.filter(project => updates.includes(ProjectFilter.update(project)));

    const found = NameSearch.apply(q, updating);

    return sort ? TableSort.apply(found, sort, ProjectFilter.SortValue[sort.column]) : found;
  }

  /** The side of the update filter `project` falls on: one no check has answered for yet counts as up to date. */
  static update(project: ProjectSummary): AppUpdate {
    return project.updateAvailable ? "available" : "current";
  }

  /** How many of `projects` give each value of `key`, for the counts of a filter menu. */
  static count(projects: readonly ProjectSummary[], key: (project: ProjectSummary) => string | undefined) {
    const counts = new Map<string, number>();

    for (const project of projects) {
      const value = key(project);

      if (value !== undefined) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    return counts;
  }
}
