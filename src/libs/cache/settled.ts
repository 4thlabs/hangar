/**
 * A promise that says how it settled, the way React reads one: a server component returning it, or
 * `use()` on it, renders a `"fulfilled"` one at once, while anything else suspends and paints the
 * Suspense fallback first, however fast it settles.
 */
export type TrackedPromise<T> = Promise<T> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

/**
 * Marks `promise` with its outcome once it settles, in the shape React reads. Returns the same
 * promise, rejection handled, so a background load that fails never crashes the process.
 */
export function track<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise as TrackedPromise<T>;

  if (tracked.status !== undefined) {
    return promise;
  }

  tracked.status = "pending";
  promise.then(
    value => {
      tracked.status = "fulfilled";
      tracked.value = value;
    },
    (reason: unknown) => {
      tracked.status = "rejected";
      tracked.reason = reason;
    },
  );

  return promise;
}

/** A promise already fulfilled with `value`, which React renders without suspending. */
export function fulfilled<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as TrackedPromise<T>;

  promise.status = "fulfilled";
  promise.value = value;

  return promise;
}

/** A promise already rejected with `reason`, which React throws at once rather than suspending. */
function rejected<T>(reason: unknown): Promise<T> {
  const promise = Promise.reject(reason as Error) as TrackedPromise<T>;

  // Handled here so it never reaches the process as unhandled; whoever reads it still gets `reason`.
  promise.catch(() => undefined);
  promise.status = "rejected";
  promise.reason = reason;

  return promise;
}

/**
 * The value of `promise` if it has already settled, `undefined` while it is pending.
 * @throws The rejection reason, when it settled that way
 */
export function peek<T>(promise: Promise<T>): { value: T } | undefined {
  const tracked = promise as TrackedPromise<T>;

  if (tracked.status === "rejected") {
    throw tracked.reason;
  }

  if (tracked.status === "fulfilled") {
    return { value: tracked.value as T };
  }

  return undefined;
}

/**
 * Derives a value from `source` without caching it, so it can never drift from its source: settled
 * in, settled out in the same call; pending in, a promise out.
 * @param project Builds the derived value; may throw, which rejects the result
 */
export function map<T, U>(source: Promise<T>, project: (value: T) => U): Promise<U> {
  const tracked = source as TrackedPromise<T>;

  if (tracked.status === "fulfilled") {
    try {
      return fulfilled(project(tracked.value as T));
    } catch (error) {
      return rejected(error);
    }
  }

  if (tracked.status === "rejected") {
    return rejected(tracked.reason);
  }

  return track(source.then(project));
}

/** Several sources as one tuple, settled at once when they all already are or one already failed. */
export function all<T extends readonly unknown[]>(sources: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const tracked = sources as readonly TrackedPromise<unknown>[];
  const failed = tracked.find(source => source.status === "rejected");
  const allFulfilled = tracked.every(source => source.status === "fulfilled");

  if (failed) {
    return rejected(failed.reason);
  }

  if (allFulfilled) {
    return fulfilled(tracked.map(source => source.value) as unknown as T);
  }

  return track(Promise.all(sources) as Promise<T>);
}

/**
 * Turns a failure of `source` into a value, settled at once when `source` already failed: what a
 * component returns to render its error state in place of the content.
 */
export function recover<T>(source: Promise<T>, onError: (error: unknown) => T): Promise<T> {
  const tracked = source as TrackedPromise<T>;

  if (tracked.status === "rejected") {
    return fulfilled(onError(tracked.reason));
  }

  if (tracked.status === "fulfilled") {
    return source;
  }

  return track(source.catch(onError));
}
