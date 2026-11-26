import fuzzysort from "fuzzysort";

/** The search of a page's list by name, which the navbar's search field drives through `?q=`. */
export class NameSearch {
  /**
   * The items whose name matches `query`, by relevance; all of them sorted by name for an empty query. Subsequence
   * matching only, as fuzzysort does it: "jfin" finds Jellyfin, a transposition finds nothing.
   */
  static apply<T extends { name: string }>(query: string, items: readonly T[]): T[] {
    if (!query) {
      return [...items].sort((left, right) => left.name.localeCompare(right.name));
    }

    return fuzzysort.go(query, items, { key: "name", limit: 0, threshold: 0 }).map(result => result.obj);
  }
}
