import type { HangarApp } from "#libs/hangar";
import { countBy } from "#modules/common/count-by.ts";
import { searchByName } from "#modules/common/search.ts";
import type { StoreFilter, StoreSearch } from "#modules/store/search-codec.ts";

/** What `/store` shows: the apps the search keeps, and how many apps each filter would keep. */
export type StoreListing = {
  apps: HangarApp[];
  counts: Record<StoreFilter, number>;
};

/** The store page's catalogue: which apps it lists, and how many each filter holds. */
export class StoreCatalog {
  /**
   * Applies the filter, then the name search, to every store app; an empty selection means no filter.
   */
  static list(all: readonly HangarApp[], search: StoreSearch): StoreListing {
    const filtered =
      search.filter.length === 0 ? all : all.filter(app => search.filter.includes(StoreCatalog.filter(app)));

    const counts = { installed: 0, available: 0, ...countBy(all, StoreCatalog.filter) };

    return { apps: searchByName(search.q, filtered), counts };
  }

  /**
   * The filter an app falls under.
   */
  private static filter(app: HangarApp): StoreFilter {
    return app.installed ? "installed" : "available";
  }
}
