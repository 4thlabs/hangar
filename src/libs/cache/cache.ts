import { logger } from "#libs/logs";
import { track } from "./settled.ts";

/** How long a cached value is used. */
export type CachePolicy = {
  /** How long the value is fresh, in milliseconds. */
  ttl: number;
  /**
   * How long past `ttl` the value is still served, at once, while it reloads; past that, readers
   * wait for the reload. This is how long a broken source stays hidden. Defaults to 0.
   */
  maxStale?: number | undefined;
};

/** One cached value. */
type Entry = {
  /** What readers get: settled once the first load has, then swapped for each successful reload. */
  served: Promise<unknown>;
  /** When {@link served} settled; `undefined` while the first load runs. */
  loadedAt: number | undefined;
  /** The load in flight, first or reload, shared by everyone who asks meanwhile. */
  loading: Promise<unknown> | undefined;
  /** The one reload a {@link Cache.refresh} queues behind a load that may predate the change. */
  queued: Promise<void> | undefined;
  /** The policy and load of the last read, which reloads reuse. */
  policy: CachePolicy;
  load: () => Promise<unknown>;
};

/** Settles a promise into nothing, for callers that only need to know it happened. */
const ignore = () => undefined;

/**
 * Values from slow sources, served at once from memory and reloaded behind the reader. Every read
 * of a value returns the same promise until it changes, marked as settled so React renders a warm
 * value without suspending (see `TrackedPromise`).
 *
 * Keys are namespaced by their owner (`docker:containers`, `widget:github-releases`), which is the
 * unit {@link refresh} works on.
 */
export class Cache {
  private readonly entries = new Map<string, Entry>();

  /**
   * The value for `key`: as cached while fresh, as cached with a reload behind it while stale, and
   * by awaiting `load` when cold or past `maxStale`. A failed load is never cached; a failed reload
   * keeps the last good value.
   * @param key Names the value, prefixed by its owner
   * @param policy How long the value is used
   * @param load Fetches the value from its source
   */
  get<T>(key: string, policy: CachePolicy, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);

    if (!entry) {
      return this.loadFirst(key, policy, load);
    }

    entry.policy = policy;
    entry.load = load;

    if (entry.loadedAt === undefined) {
      return entry.served as Promise<T>;
    }

    const age = Date.now() - entry.loadedAt;
    const maxStale = policy.maxStale ?? 0;

    if (age < policy.ttl) {
      return entry.served as Promise<T>;
    }

    const reload = this.reload(key, entry);

    if (age < policy.ttl + maxStale) {
      return entry.served as Promise<T>;
    }

    return reload as Promise<T>;
  }

  /**
   * Reloads every cached value whose key starts with `prefix`, for whoever learns its source has
   * changed. Readers keep the current value meanwhile. A load already in flight may predate the
   * change, so one more follows it. Values never read are left alone.
   * @returns Settles once a load started after this call has, and never rejects
   */
  refresh(prefix: string): Promise<void> {
    const refreshes = [...this.entries]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, entry]) => this.refreshEntry(key, entry));

    return Promise.all(refreshes).then(ignore);
  }

  /**
   * Reloads, every `intervalMs`, each value that would go stale before the next tick, so a reader
   * never meets a stale one. Values are kept warm once read, for the life of the process.
   * @returns Stops the loop
   */
  keepWarm(intervalMs: number): () => void {
    const timer = setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of this.entries) {
        const goesStaleBeforeNextTick =
          entry.loadedAt !== undefined && now + intervalMs >= entry.loadedAt + entry.policy.ttl;

        if (goesStaleBeforeNextTick) {
          void this.reload(key, entry).catch(ignore);
        }
      }
    }, intervalMs);

    // Never a reason to hold the process open: a reload is owed to no one.
    timer.unref();

    return () => clearInterval(timer);
  }

  /**
   * Forgets every value whose key starts with `prefix`. For tests, which share a process; the app
   * calls {@link refresh}, which keeps serving the old value while the new one loads.
   */
  clear(prefix: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /** Loads a value nobody has cached yet; forgets it again if the load fails. */
  private loadFirst<T>(key: string, policy: CachePolicy, load: () => Promise<T>): Promise<T> {
    const loading = track(load());

    const entry: Entry = { served: loading, loadedAt: undefined, loading, queued: undefined, policy, load };

    this.entries.set(key, entry);

    loading.then(
      () => {
        entry.loadedAt = Date.now();
        entry.loading = undefined;
      },
      () => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      },
    );

    return loading;
  }

  /**
   * Reloads a cached value, or joins the load already in flight. Publishes the new value once it
   * settles, unless {@link clear} dropped the entry meanwhile; a failure is logged and leaves the
   * served value as it was, still ageing.
   * @returns The load, rejecting if it fails
   */
  private reload(key: string, entry: Entry): Promise<unknown> {
    if (entry.loading) {
      return entry.loading;
    }

    const loading = track(entry.load());

    entry.loading = loading;
    loading.then(
      () => {
        entry.loading = undefined;

        if (this.entries.get(key) === entry) {
          entry.served = loading;
          entry.loadedAt = Date.now();
        }
      },
      (error: unknown) => {
        entry.loading = undefined;
        logger.warn("Could not reload a cached value", { error, key });
      },
    );

    return loading;
  }

  /** Implements {@link refresh} for one entry. */
  private refreshEntry(key: string, entry: Entry): Promise<void> {
    if (!entry.loading) {
      return this.reload(key, entry).then(ignore, ignore);
    }

    entry.queued ??= entry.loading
      .then(ignore, ignore)
      .then(() => {
        entry.queued = undefined;

        // A first load that failed took its entry with it: nothing left to refresh.
        if (this.entries.get(key) !== entry) {
          return undefined;
        }

        return this.reload(key, entry);
      })
      .then(ignore, ignore);

    return entry.queued;
  }
}
