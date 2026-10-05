import type { Unstable_SearchCodec } from "waku/router";

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
    if (q) {
      params.set("q", q);
    }
    if (filter.length > 0) {
      params.set("filter", filter.join(","));
    }

    return params.toString();
  },
};
