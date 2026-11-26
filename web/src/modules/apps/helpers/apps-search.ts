import { ProjectStatus } from "#libs/api";
import { parseSort, serializeSort, type SortState } from "#modules/common/table-sort.ts";

/** The sortable columns of the apps' table. */
export type AppSortColumn = "name" | "category" | "status" | "services" | "containers" | "unhealthy";

/** The order of the apps' table: a column and its direction, or `null` for the default order. */
export type AppsSort = SortState<AppSortColumn>;

/** Which side of the update filter an app falls on: an image check found an update for it, or did not. */
export type AppUpdate = "available" | "current";

/**
 * The search of `/apps`, as the Waku version writes it: `q`, the name the navbar's search field narrows the apps by,
 * `status`, `category` and `update`, the filters ticked, comma-separated, and `sort`, a column, `-` before it for
 * descending.
 */
export type AppsSearch = {
  q?: string | undefined;
  status?: string | undefined;
  category?: string | undefined;
  update?: string | undefined;
  sort?: string | undefined;
};

// Reads and writes the search of `/apps`.

/** Every status, in the order the filter menu lists them, which is also the order the status column sorts by. */
export const appStatuses: readonly ProjectStatus[] = [
  ProjectStatus.running,
  ProjectStatus.partial,
  ProjectStatus.stopped,
  ProjectStatus.unhealthy,
];

/** Both sides of the update filter, in the order its menu lists them. */
export const appUpdates: readonly AppUpdate[] = ["available", "current"];

/** What the update filter's menu calls each side. */
export const appUpdateLabels: Readonly<Record<AppUpdate, string>> = { available: "Available", current: "Up to date" };

/** The sortable columns, in the table's order. */
export const appSortColumns: readonly AppSortColumn[] = [
  "name",
  "category",
  "status",
  "services",
  "containers",
  "unhealthy",
];

/** The search of a URL: a value of another type left out, and an unknown status or column dropped. */
export function validateAppsSearch(search: Record<string, unknown>): AppsSearch {
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const sort = parseAppsSort(search.sort);

  const validated: AppsSearch = {
    q: text(search.q),
    status: joinSearchValues(parseAppStatuses(search.status)),
    category: joinSearchValues(parseAppCategories(search.category)),
    update: joinSearchValues(parseAppUpdates(search.update)),
    sort: sort ? serializeSort(sort) : undefined,
  };

  return Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== undefined));
}

/** The statuses `status` ticks, in the menu's order. */
export function parseAppStatuses(status: unknown): ProjectStatus[] {
  const ticked = new Set(typeof status === "string" ? status.split(",") : []);

  return appStatuses.filter(candidate => ticked.has(candidate));
}

/** The sides of the update filter `update` ticks, in the menu's order. */
export function parseAppUpdates(update: unknown): AppUpdate[] {
  const ticked = new Set(typeof update === "string" ? update.split(",") : []);

  return appUpdates.filter(candidate => ticked.has(candidate));
}

/** The categories `category` ticks, as `hangar.yml` names them: one that matches no app keeps none. */
export function parseAppCategories(category: unknown): string[] {
  return typeof category === "string" ? category.split(",").filter(Boolean) : [];
}

/** The order `sort` names, `null` for the default one. */
export function parseAppsSort(sort: unknown): AppsSort {
  return typeof sort === "string" ? parseSort(sort, appSortColumns) : null;
}

/** The comma-separated `values`, `undefined` for none. */
export function joinSearchValues(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}
