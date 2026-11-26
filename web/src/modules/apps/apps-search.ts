import { ProjectStatus } from "#libs/api";
import { TableSort, type SortState } from "#modules/common/table-sort.ts";

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

/** Reads and writes the search of `/apps`. */
export class AppsSearchParams {
  /** Every status, in the order the filter menu lists them, which is also the order the status column sorts by. */
  static readonly Statuses: readonly ProjectStatus[] = [
    ProjectStatus.running,
    ProjectStatus.partial,
    ProjectStatus.stopped,
    ProjectStatus.unhealthy,
  ];

  /** Both sides of the update filter, in the order its menu lists them. */
  static readonly Updates: readonly AppUpdate[] = ["available", "current"];

  /** What the update filter's menu calls each side. */
  static readonly UpdateLabels: Readonly<Record<AppUpdate, string>> = { available: "Available", current: "Up to date" };

  /** The sortable columns, in the table's order. */
  static readonly SortColumns: readonly AppSortColumn[] = [
    "name",
    "category",
    "status",
    "services",
    "containers",
    "unhealthy",
  ];

  /** The search of a URL: a value of another type left out, and an unknown status or column dropped. */
  static validate(search: Record<string, unknown>): AppsSearch {
    const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
    const sort = AppsSearchParams.sort(search.sort);

    const validated: AppsSearch = {
      q: text(search.q),
      status: AppsSearchParams.write(AppsSearchParams.statuses(search.status)),
      category: AppsSearchParams.write(AppsSearchParams.categories(search.category)),
      update: AppsSearchParams.write(AppsSearchParams.updates(search.update)),
      sort: sort ? TableSort.serialize(sort) : undefined,
    };

    return Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== undefined));
  }

  /** The statuses `status` ticks, in the menu's order. */
  static statuses(status: unknown): ProjectStatus[] {
    const ticked = new Set(typeof status === "string" ? status.split(",") : []);

    return AppsSearchParams.Statuses.filter(candidate => ticked.has(candidate));
  }

  /** The sides of the update filter `update` ticks, in the menu's order. */
  static updates(update: unknown): AppUpdate[] {
    const ticked = new Set(typeof update === "string" ? update.split(",") : []);

    return AppsSearchParams.Updates.filter(candidate => ticked.has(candidate));
  }

  /** The categories `category` ticks, as `hangar.yml` names them: one that matches no app keeps none. */
  static categories(category: unknown): string[] {
    return typeof category === "string" ? category.split(",").filter(Boolean) : [];
  }

  /** The order `sort` names, `null` for the default one. */
  static sort(sort: unknown): AppsSort {
    return typeof sort === "string" ? TableSort.parse(sort, AppsSearchParams.SortColumns) : null;
  }

  /** The comma-separated `values`, `undefined` for none. */
  static write(values: readonly string[]): string | undefined {
    return values.length > 0 ? values.join(",") : undefined;
  }
}
