import type { HangarApp } from "#libs/hangar";
import { searchByName } from "#modules/common/search.ts";
import type { StoreFilter, StoreSearch } from "#modules/store/search-codec.ts";

/** What `/store` shows: the apps the search keeps, and how many apps each filter would keep. */
export type StoreListing = {
  apps: HangarApp[];
  counts: Record<StoreFilter, number>;
};

const filterOf = (app: HangarApp): StoreFilter => (app.installed ? "installed" : "available");

/** Applies the filter, then the name search, to every store app; an empty selection means no filter. */
export function storeListing(all: readonly HangarApp[], search: StoreSearch): StoreListing {
  const filtered = search.filter.length === 0 ? all : all.filter(app => search.filter.includes(filterOf(app)));

  const counts = {
    installed: all.filter(app => filterOf(app) === "installed").length,
    available: all.filter(app => filterOf(app) === "available").length,
  };

  return { apps: searchByName(search.q, filtered), counts };
}
