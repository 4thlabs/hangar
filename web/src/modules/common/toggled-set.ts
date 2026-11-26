/**
 * A copy of `current` with `value` in it when `included`, as a checkbox reports it, and without it otherwise, for React
 * state that must never be mutated.
 */
export function toggledSet<T>(current: ReadonlySet<T>, value: T, included: boolean): ReadonlySet<T> {
  const next = new Set(current);

  if (included) {
    next.add(value);
  } else {
    next.delete(value);
  }

  return next;
}
