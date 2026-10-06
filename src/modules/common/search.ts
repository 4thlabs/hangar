import fuzzysort from "fuzzysort";

/**
 * Fuzzy name search by relevance; an empty query sorts alphabetically. Subsequence matching only.
 * ponytail: misses transpositions ("nextcould"); swap in a trigram/Levenshtein matcher if that shows up.
 */
export function searchByName<T extends { name: string }>(query: string, items: readonly T[]): T[] {
  if (!query) {
    return [...items].sort((left, right) => left.name.localeCompare(right.name));
  }

  return fuzzysort.go(query, items, { key: "name", limit: 0, threshold: 0 }).map(result => result.obj);
}
