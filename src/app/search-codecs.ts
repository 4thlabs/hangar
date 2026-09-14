import type { Unstable_SearchCodec } from "waku/router";
import type { ComposeProjectStatus } from "#libs/docker/projects.ts";

export type StoreFilter = "installed" | "available";
export type StoreSearch = { q: string; filter: StoreFilter[] };

/** Both store filters, in the order the filter menu lists them. */
export const STORE_FILTERS: StoreFilter[] = ["installed", "available"];

/**
 * Search params of `/store`, shared by the server (via `unstable_searchCodec`
 * in the page's `getConfig`) and the client (via `Unstable_SearchCodecsProvider`).
 *
 * `filter` is a comma-separated multi-select, an empty list meaning "no filter". Unknown
 * values are dropped rather than rejected: a hand-edited URL should not turn into a 400,
 * and the old single-value `?filter=installed` still parses to exactly what it used to mean.
 */
export const storeSearchCodec: Unstable_SearchCodec<StoreSearch> = {
  id: "store",
  parse: query => {
    const params = new URLSearchParams(query);
    const requested = new Set((params.get("filter") ?? "").split(","));

    return {
      q: params.get("q") ?? "",
      filter: STORE_FILTERS.filter(filter => requested.has(filter)),
    };
  },
  serialize: ({ q, filter }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filter.length > 0) params.set("filter", filter.join(","));

    return params.toString();
  },
};

/** Every Compose status, in the order the filter menu lists them. */
export const APP_STATUSES: ComposeProjectStatus[] = ["running", "partial", "stopped", "unhealthy"];

/** Sortable columns of the apps table. */
export const APP_SORT_COLUMNS = ["name", "status", "services", "containers", "unhealthy"] as const;
export type AppSortColumn = (typeof APP_SORT_COLUMNS)[number];

/** `null` means the default order: search relevance when there is a query, alphabetical otherwise. */
export type AppsSort = { column: AppSortColumn; descending: boolean } | null;

export type AppsSearch = { q: string; status: ComposeProjectStatus[]; sort: AppsSort };

/**
 * Search params of `/apps`. `status` is a comma-separated multi-select: an empty list means
 * "no filter", so the default state stays out of the URL entirely. Unknown values are dropped
 * rather than rejected, for the same reason the store falls back to `"all"`.
 */
export const appsSearchCodec: Unstable_SearchCodec<AppsSearch> = {
  id: "apps",
  parse: query => {
    const params = new URLSearchParams(query);
    const requested = new Set((params.get("status") ?? "").split(","));

    const sort = params.get("sort") ?? "";
    const descending = sort.startsWith("-");
    const column = descending ? sort.slice(1) : sort;

    return {
      q: params.get("q") ?? "",
      status: APP_STATUSES.filter(status => requested.has(status)),
      sort: APP_SORT_COLUMNS.includes(column as AppSortColumn) ? { column: column as AppSortColumn, descending } : null,
    };
  },
  serialize: ({ q, status, sort }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status.length > 0) params.set("status", status.join(","));
    if (sort) params.set("sort", `${sort.descending ? "-" : ""}${sort.column}`);

    return params.toString();
  },
};

export const searchCodecs = [storeSearchCodec, appsSearchCodec];
