import fuzzysort from "fuzzysort";

/**
 * The items of a page's list whose name matches `query`, which the navbar's search field drives through `?q=`, by
 * relevance; all of them sorted by name for an empty query. Subsequence matching only, as fuzzysort does it: "jfin"
 * finds Jellyfin, a transposition finds nothing.
 */
export function searchByName<T extends { name: string }>(query: string, items: readonly T[]): T[] {
  if (!query) {
    return [...items].sort((left, right) => left.name.localeCompare(right.name));
  }

  return fuzzysort.go(query, items, { key: "name", limit: 0, threshold: 0 }).map(result => result.obj);
}
