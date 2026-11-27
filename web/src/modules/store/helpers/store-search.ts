import { AppFilter } from "#libs/api";

/**
 * The search of `/store`: `q`, the name the navbar's search field narrows the apps by, and `filter`, the filters
 * ticked, comma-separated as the Waku version writes them, `?filter=installed,available`.
 */
export type StoreSearch = { q?: string | undefined; filter?: string | undefined };

// Reads and writes the search of `/store`.

/** Both filters, in the order the filter menu lists them. */
export const storeFilters: readonly AppFilter[] = [AppFilter.installed, AppFilter.available];

/** The search of a URL: a value of another type left out, and an unknown filter dropped, so that a hand-edited URL is no error. */
export function validateStoreSearch(search: Record<string, unknown>): StoreSearch {
  const q = typeof search.q === "string" && search.q !== "" ? search.q : undefined;
  const filter = joinStoreFilters(parseStoreFilters(search.filter));

  return { ...(q === undefined ? {} : { q }), ...(filter === undefined ? {} : { filter }) };
}

/** The filters `filter` ticks, in the menu's order; none for no filter. */
export function parseStoreFilters(filter: unknown): AppFilter[] {
  const ticked = new Set(typeof filter === "string" ? filter.split(",") : []);

  return storeFilters.filter(candidate => ticked.has(candidate));
}

/** The `filter` of `filters`, `undefined` for none. */
export function joinStoreFilters(filters: readonly AppFilter[]): string | undefined {
  return filters.length > 0 ? filters.join(",") : undefined;
}
