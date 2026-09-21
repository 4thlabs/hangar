/**
 * One cached read: the promise as it was handed out, the value it settled to once it has one, and
 * when it stops being fresh.
 *
 * The settled value is kept separately, and carried across a reload, so a reader can have it
 * *without awaiting* — see {@link Snapshots.peek}. Wrapped in an object so a cached `undefined` is
 * still distinguishable from nothing cached.
 */
type CacheEntry = { value: Promise<unknown>; settled?: { data: unknown } | undefined; until: number };

/**
 * Reads that answer from the last snapshot and refresh themselves behind the caller.
 *
 * Nothing in here is on a timer: a value is only reloaded because somebody asked for it. Filling
 * it *before* anyone asks is a caller's job — see `src/app/middleware/warm-cache.ts`, which is
 * what keeps a first page render from waiting on anything.
 *
 * Holds no state of its own beyond the map, so a composition root can own one per concern: the
 * Docker client has one for its daemon reads, the widget layer one for every widget's `load`.
 */
export class Snapshots {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * Serves `key` from the last snapshot, and refreshes it behind the caller once it goes stale.
   * A read inside `ttl` is the snapshot; a read within `grace` past it is *still* the snapshot,
   * handed back at once with a reload started behind it; past that the caller waits on `load` and
   * gets its error.
   *
   * `grace` therefore has one plain meaning: how long a broken source stays hidden. A reload that
   * fails restores the entry it replaced, timestamp and all, so the snapshot keeps ageing and the
   * next read past `ttl + grace` surfaces the real error rather than a stale answer forever.
   *
   * Only raw reads belong in here, never anything derived from one: a "not found" thrown downstream
   * of a cached value must stay downstream of it, or it gets cached as though it were the value.
   *
   * @param key Which read this is; also the unit {@link clear} drops
   * @param ttl How long the value is fresh, in milliseconds
   * @param grace How long past `ttl` it is still served while reloading
   * @param load Fetches a new value
   */
  read<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): Promise<T> {
    const ready = this.peek<T>(key, ttl, grace, load);

    if (ready) return Promise.resolve(ready.data);

    const entry = this.entries.get(key);

    // Nothing settled yet but a load is already out: share it rather than starting a second.
    if (entry && Date.now() < entry.until) return entry.value as Promise<T>;

    return this.refresh(key, entry, ttl, load);
  }

  /**
   * The value, if one is cached and still usable, **without awaiting anything**.
   *
   * This is what keeps a page from painting a spinner. A React component that awaits suspends, and
   * a suspended boundary puts its fallback in the shell however fast the promise settles — so a
   * warm cache alone buys a quicker swap, not the absence of one. Reading synchronously is the only
   * thing that stops the boundary existing.
   *
   * Same staleness rules as {@link read}, including starting a reload behind the caller, and the
   * settled value is carried across that reload — so a refresh in flight never costs a reader the
   * snapshot it could have had.
   *
   * `undefined` means "ask properly": nothing cached, or what is cached is past `ttl + grace`.
   */
  peek<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): { data: T } | undefined {
    const entry = this.entries.get(key);

    if (!entry?.settled) return undefined;

    const now = Date.now();

    if (now < entry.until) return entry.settled as { data: T };

    // Stale but inside the grace window: hand back what we have, reload behind it. The floating
    // promise is safe only because `refresh` attaches its own handler to it — without that, a
    // source going down would surface as an unhandled rejection, which by default kills the process.
    if (now < entry.until + grace) {
      void this.refresh(key, entry, ttl, load);

      return entry.settled as { data: T };
    }

    return undefined;
  }

  /**
   * Loads a fresh value into `key` and publishes it once it settles.
   *
   * Both handlers check they still own the slot before touching it: a load started before a
   * {@link clear} can settle after it, and must not publish what that clear declared untrue.
   *
   * @param previous The entry being replaced, restored as-is if the load fails
   */
  private refresh<T>(key: string, previous: CacheEntry | undefined, ttl: number, load: () => Promise<T>): Promise<T> {
    const value = load();

    // Carries the old settled value, so a reader during the reload still gets it instead of waiting.
    // In flight it never expires, so concurrent callers share one round trip; staleness only
    // starts once it has settled.
    const entry: CacheEntry = { value, settled: previous?.settled, until: Number.POSITIVE_INFINITY };

    this.entries.set(key, entry);

    value.then(
      data => {
        if (this.entries.get(key) !== entry) return;
        entry.settled = { data };
        entry.until = Date.now() + ttl;
      },
      () => {
        if (this.entries.get(key) !== entry) return;
        if (previous) this.entries.set(key, previous);
        else this.entries.delete(key);
      },
    );

    return value;
  }

  /** Drops every snapshot, so the next read goes back to the source. */
  clear() {
    this.entries.clear();
  }
}
