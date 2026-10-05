import type { Unstable_SearchCodec } from "waku/router";
import type { ComposeProjectStatus } from "#libs/docker";

/** Every Compose status, in the order the filter menu lists them. */
export const APP_STATUSES: ComposeProjectStatus[] = ["running", "partial", "stopped", "unhealthy"];

/** Both update states, in the order the filter menu lists them. */
export const APP_UPDATES = ["available", "current"] as const;
export type AppUpdate = (typeof APP_UPDATES)[number];

/** Sortable columns of the apps table. */
export const APP_SORT_COLUMNS = ["name", "category", "status", "services", "containers", "unhealthy"] as const;
export type AppSortColumn = (typeof APP_SORT_COLUMNS)[number];

/** `null` means the default order: search relevance when there is a query, alphabetical otherwise. */
export type AppsSort = { column: AppSortColumn; descending: boolean } | null;

export type AppsSearch = {
  q: string;
  status: ComposeProjectStatus[];
  category: string[];
  update: AppUpdate[];
  sort: AppsSort;
};

/**
 * Search params of `/apps`. `status`, `category` and `update` are comma-separated multi-selects: an empty
 * list means "no filter", so the default state stays out of the URL entirely. Unknown statuses are
 * dropped rather than rejected, for the same reason the store falls back to `"all"`.
 *
 * Categories come from the user's `hangar.yml`, so there is no closed list to validate against:
 * values are kept as written, and one that matches nothing simply yields no rows.
 */
export const appsSearchCodec: Unstable_SearchCodec<AppsSearch> = {
  id: "apps",
  parse: query => {
    const params = new URLSearchParams(query);
    const requested = new Set((params.get("status") ?? "").split(","));
    const updates = new Set((params.get("update") ?? "").split(","));

    const sort = params.get("sort") ?? "";
    const descending = sort.startsWith("-");
    const column = descending ? sort.slice(1) : sort;

    return {
      q: params.get("q") ?? "",
      status: APP_STATUSES.filter(status => requested.has(status)),
      category: (params.get("category") ?? "").split(",").filter(Boolean),
      update: APP_UPDATES.filter(update => updates.has(update)),
      sort: APP_SORT_COLUMNS.includes(column as AppSortColumn) ? { column: column as AppSortColumn, descending } : null,
    };
  },
  serialize: ({ q, status, category, update, sort }) => {
    const params = new URLSearchParams();
    if (q) {
      params.set("q", q);
    }
    if (status.length > 0) {
      params.set("status", status.join(","));
    }
    if (category.length > 0) {
      params.set("category", category.join(","));
    }
    if (update.length > 0) {
      params.set("update", update.join(","));
    }
    if (sort) {
      params.set("sort", `${sort.descending ? "-" : ""}${sort.column}`);
    }

    return params.toString();
  },
};
