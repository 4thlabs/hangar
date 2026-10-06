import type { Unstable_SearchCodec } from "waku/router";

export type StoreFilter = "installed" | "available";
export type StoreSearch = { q: string; filter: StoreFilter[] };

/** Both store filters, in the order the filter menu lists them. */
export const STORE_FILTERS: StoreFilter[] = ["installed", "available"];

/**
 * Search params of `/store`, shared by the page's `getConfig` and the client's `Unstable_SearchCodecsProvider`.
 * `filter`: comma-separated multi-select; empty = no filter, unknown values dropped so a hand-edited URL is no 400.
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
