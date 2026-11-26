import { ProjectStatus } from "#libs/api";
import { TableSort, type SortState } from "#modules/common/table-sort.ts";

/** The sortable columns of the apps' table. */
export type AppSortColumn = "name" | "category" | "status" | "services" | "containers" | "unhealthy";

/** The order of the apps' table: a column and its direction, or `null` for the default order. */
export type AppsSort = SortState<AppSortColumn>;

/**
 * The search of `/apps`, as the Waku version writes it: `q`, the name the navbar's search field narrows the apps by,
 * `status` and `category`, the filters ticked, comma-separated, and `sort`, a column, `-` before it for descending.
 */
export type AppsSearch = {
  q?: string | undefined;
  status?: string | undefined;
  category?: string | undefined;
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
      sort: sort ? TableSort.serialize(sort) : undefined,
    };

    return Object.fromEntries(Object.entries(validated).filter(([, value]) => value !== undefined));
  }

  /** The statuses `status` ticks, in the menu's order. */
  static statuses(status: unknown): ProjectStatus[] {
    const ticked = new Set(typeof status === "string" ? status.split(",") : []);

    return AppsSearchParams.Statuses.filter(candidate => ticked.has(candidate));
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
