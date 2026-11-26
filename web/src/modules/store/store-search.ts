import { AppFilter } from "#libs/api";

/**
 * The search of `/store`: `q`, the name the navbar's search field narrows the apps by, and `filter`, the filters
 * ticked, comma-separated as the Waku version writes them, `?filter=installed,available`.
 */
export type StoreSearch = { q?: string | undefined; filter?: string | undefined };

/** Reads and writes the search of `/store`. */
export class StoreSearchParams {
  /** Both filters, in the order the filter menu lists them. */
  static readonly Filters: readonly AppFilter[] = [AppFilter.installed, AppFilter.available];

  /** What each filter is called in the menu. */
  static readonly Labels: Readonly<Record<AppFilter, string>> = { installed: "Installed", available: "Not installed" };

  /** The search of a URL: a value of another type left out, and an unknown filter dropped, so that a hand-edited URL is no error. */
  static validate(search: Record<string, unknown>): StoreSearch {
    const q = typeof search.q === "string" && search.q !== "" ? search.q : undefined;
    const filter = StoreSearchParams.write(StoreSearchParams.read(search.filter));

    return { ...(q === undefined ? {} : { q }), ...(filter === undefined ? {} : { filter }) };
  }

  /** The filters `filter` ticks, in the menu's order; none for no filter. */
  static read(filter: unknown): AppFilter[] {
    const ticked = new Set(typeof filter === "string" ? filter.split(",") : []);

    return StoreSearchParams.Filters.filter(candidate => ticked.has(candidate));
  }

  /** The `filter` of `filters`, `undefined` for none. */
  static write(filters: readonly AppFilter[]): string | undefined {
    return filters.length > 0 ? filters.join(",") : undefined;
  }
}
