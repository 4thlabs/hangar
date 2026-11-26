import type { EnvChanges } from "#libs/api";

/** What a save sends: what changed since the read, so that a change made to the file meanwhile is not undone. */
export class EnvChangeSet {
  /**
   * The values of `values` that differ from `read`, the new variables among them, and the variables of `read` that
   * `removed` names. A value edited in the file after the read, or a variable removed from it, is left as the file has
   * it unless it was changed here too.
   */
  static create(read: Record<string, string>, values: Record<string, string>, removed: readonly string[]): EnvChanges {
    const updates = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => !Object.hasOwn(read, key) || read[key] !== value),
    );

    return { updates, remove: removed.filter(key => Object.hasOwn(read, key)) };
  }
}
