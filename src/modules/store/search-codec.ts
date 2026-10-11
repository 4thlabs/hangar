import type { Unstable_SearchCodec } from "waku/router";

export type StoreSearch = { q: string };

/**
 * Search params of `/store`, shared by the page's `getConfig` and the client's `Unstable_SearchCodecsProvider`.
 * Only the name search: what an app runs is for the Apps and Cluster pages to say.
 */
export const storeSearchCodec: Unstable_SearchCodec<StoreSearch> = {
  id: "store",
  parse: query => ({ q: new URLSearchParams(query).get("q") ?? "" }),
  serialize: ({ q }) => {
    const params = new URLSearchParams();

    if (q) {
      params.set("q", q);
    }

    return params.toString();
  },
};
