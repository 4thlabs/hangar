import type { Unstable_SearchCodec } from "waku/router";

export type StoreFilter = "all" | "installed" | "available";
export type StoreSearch = { q: string; filter: StoreFilter };

/**
 * Search params of `/store`, shared by the server (via `unstable_searchCodec`
 * in the page's `getConfig`) and the client (via `Unstable_SearchCodecsProvider`).
 * An unknown `filter` falls back to `"all"` rather than throwing: a hand-edited
 * URL should not turn into a 400.
 */
export const storeSearchCodec: Unstable_SearchCodec<StoreSearch> = {
  id: "store",
  parse: query => {
    const params = new URLSearchParams(query);
    const filter = params.get("filter");

    return {
      q: params.get("q") ?? "",
      filter: filter === "installed" || filter === "available" ? filter : "all",
    };
  },
  serialize: ({ q, filter }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filter !== "all") params.set("filter", filter);

    return params.toString();
  },
};

export const searchCodecs = [storeSearchCodec];
