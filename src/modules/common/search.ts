import fuzzysort from "fuzzysort";

/**
 * Narrows a list to what matches `query` on the `name` field, ordered by relevance.
 * An empty query orders alphabetically instead: that is the only fallback, so the store and the
 * apps list cannot drift apart on what "no search" looks like.
 *
 * threshold 0: fuzzysort still requires the query's chars in order, so the score cutoff only drops
 * typo-tolerant hits. ponytail: subsequence matching misses transpositions ("nextcould"), swap in
 * a trigram/Levenshtein matcher if that shows up in practice.
 *
 * @param query The raw search string, empty meaning "no search"
 * @param items The candidates, never mutated
 */
export function searchByName<T extends { name: string }>(query: string, items: readonly T[]): T[] {
  if (!query) return [...items].sort((left, right) => left.name.localeCompare(right.name));

  return fuzzysort.go(query, items, { key: "name", limit: 0, threshold: 0 }).map(result => result.obj);
}
