/**
 * How many items carry each value, for the counts shown beside each checkbox.
 * An item the key does not apply to — an app in no category — counts towards nothing.
 */
export function countBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K | undefined,
): Partial<Record<K, number>> {
  // A Map, not `{}`: the values come from the operator (category names), and `constructor` or
  // `__proto__` would read through Object.prototype.
  const counts = new Map<K, number>();

  for (const item of items) {
    const value = key(item);

    if (value !== undefined) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return Object.fromEntries(counts) as Partial<Record<K, number>>;
}
