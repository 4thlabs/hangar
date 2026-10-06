/** One cached read. */
type CacheEntry = {
  /** The load as it was handed out. */
  value: Promise<unknown>;
  /** What it settled to, kept across a reload for {@link Cache.peek}; boxed so `undefined` can be cached. */
  settled?: { data: unknown } | undefined;
  /** When it stops being fresh; infinite while the load is in flight. */
  until: number;
  /** The reload {@link Cache.revalidate} queued behind an in-flight load, shared by later calls. */
  next?: Promise<void> | undefined;
};

/** Swallows a settlement, for the promises whose callers only need to know it happened. */
const settle = () => undefined;

/** One cached read with its key, TTL, grace and loader bound once — see {@link Cache.define}. */
export type Snapshot<T> = {
  /** The value, awaiting a load when there is nothing usable cached. */
  read(): Promise<T>;
  /** The value without awaiting anything, or `undefined` to say "ask properly". */
  peek(): { data: T } | undefined;
  /**
   * Fills the snapshot ahead of a render. Never rejects: a source being down is the render's to
   * report, and an unhandled rejection in a background tick would kill the process.
   */
  warm(): Promise<void>;
  /**
   * Reloads now, for whoever learns the source has changed; readers keep the current value
   * meanwhile. Resolves once a load started after the call has settled. Never rejects.
   */
  refresh(): Promise<void>;
};

/**
 * Reads that answer from the last snapshot and refresh themselves behind the caller. No timer:
 * filling it before anyone asks is `src/app/middleware/cache-warm.ts`'s job.
 */
export class Cache {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * Serves `key` from the snapshot: as is within `ttl`, with a reload behind it within `grace`
   * past that, and by awaiting `load` beyond. `grace` is how long a broken source stays hidden.
   * Cache raw reads only: an error derived from a cached value would get cached as the value.
   * @param key Which read this is; also the unit {@link clear} drops
   * @param ttl How long the value is fresh, in milliseconds
   * @param grace How long past `ttl` it is still served while reloading
   * @param load Fetches a new value
   */
  read<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): Promise<T> {
    const ready = this.peek<T>(key, ttl, grace, load);

    if (ready) {
      return Promise.resolve(ready.data);
    }

    const entry = this.entries.get(key);

    // Nothing settled yet but a load is already out: share it rather than starting a second.
    if (entry && Date.now() < entry.until) {
      return entry.value as Promise<T>;
    }

    return this.refresh(key, entry, ttl, load);
  }

  /**
   * The value without awaiting, or `undefined` ("ask properly"). Awaiting would suspend and paint a
   * fallback however warm the cache is. Same staleness rules as {@link read}.
   */
  peek<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): { data: T } | undefined {
    const entry = this.entries.get(key);

    if (!entry?.settled) {
      return undefined;
    }

    const now = Date.now();

    if (now < entry.until) {
      return entry.settled as { data: T };
    }

    // Stale but within grace. Floating is safe: `refresh` attaches its own rejection handler.
    if (now < entry.until + grace) {
      void this.refresh(key, entry, ttl, load);

      return entry.settled as { data: T };
    }

    return undefined;
  }

  /**
   * Loads a fresh value into `key` and publishes it once it settles, unless a {@link clear} replaced
   * the entry meanwhile.
   * @param previous The entry being replaced, restored as-is if the load fails
   */
  private refresh<T>(key: string, previous: CacheEntry | undefined, ttl: number, load: () => Promise<T>): Promise<T> {
    const value = load();

    // Keeps the old value for readers; never expires in flight, so concurrent callers share the load.
    const entry: CacheEntry = { value, settled: previous?.settled, until: Number.POSITIVE_INFINITY };

    this.entries.set(key, entry);

    value.then(
      data => {
        if (this.entries.get(key) !== entry) {
          return;
        }
        entry.settled = { data };
        entry.until = Date.now() + ttl;
      },
      () => {
        if (this.entries.get(key) !== entry) {
          return;
        }
        if (previous) {
          this.entries.set(key, previous);
        } else {
          this.entries.delete(key);
        }
      },
    );

    return value;
  }

  /**
   * Implements {@link Snapshot.refresh}. A load in flight may predate the change, so one more load
   * follows it, shared by every call that arrives meanwhile. Nothing cached is left alone.
   * @returns Settles once a load started after this call has, and never rejects
   */
  revalidate<T>(key: string, ttl: number, load: () => Promise<T>): Promise<void> {
    const entry = this.entries.get(key);

    if (!entry) {
      return Promise.resolve();
    }

    if (!Number.isFinite(entry.until)) {
      entry.next ??= entry.value.then(settle, settle).then(() => this.revalidate(key, ttl, load));

      return entry.next;
    }

    return this.refresh(key, entry, ttl, load).then(settle, settle);
  }

  /** Binds one read's key, TTL, grace and loader into a {@link Snapshot}; prefer it to {@link read}. */
  define<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): Snapshot<T> {
    return {
      read: () => this.read(key, ttl, grace, load),
      peek: () => this.peek(key, ttl, grace, load),
      warm: () =>
        this.read(key, ttl, grace, load).then(
          () => undefined,
          () => undefined,
        ),
      refresh: () => this.revalidate(key, ttl, load),
    };
  }

  /** Drops every snapshot, so the next read goes back to the source. */
  clear() {
    this.entries.clear();
  }

  /**
   * A snapshot derived from one or two others. Caches nothing itself, so it cannot drift from them.
   * @param project Builds the derived value; must stay pure, since it runs on every read and peek
   */
  static join<A, B>(a: Snapshot<A>, project: (a: A) => B): Snapshot<B>;
  static join<A, B, C>(a: Snapshot<A>, b: Snapshot<B>, project: (a: A, b: B) => C): Snapshot<C>;
  static join(...args: readonly unknown[]): Snapshot<unknown> {
    const project = args[args.length - 1] as (...values: readonly unknown[]) => unknown;
    const sources = args.slice(0, -1) as readonly Snapshot<unknown>[];

    return {
      read: async () => project(...(await Promise.all(sources.map(source => source.read())))),
      peek: () => {
        // Peek every source first: a peek is what starts a stale entry's reload.
        const ready = sources.map(source => source.peek());
        const values: unknown[] = [];

        for (const entry of ready) {
          if (!entry) {
            return undefined;
          }

          values.push(entry.data);
        }

        return { data: project(...values) };
      },
      warm: () => Promise.all(sources.map(source => source.warm())).then(() => undefined),
      refresh: () => Promise.all(sources.map(source => source.refresh())).then(() => undefined),
    };
  }
}
