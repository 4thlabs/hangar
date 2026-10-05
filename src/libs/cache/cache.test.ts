import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache.ts";

/** A fixed point to move away from; nothing here is on a timer, the class only reads the clock. */
const START = 1_700_000_000_000;

const TTL = 60_000;
const GRACE = 600_000;

/** Only `Date` is faked: every `await` in here still settles on real microtasks. */
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));
afterEach(() => vi.useRealTimers());

describe("Cache", () => {
  it("serves a fresh value without going back to the source", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    expect(await cache.read("k", TTL, GRACE, load)).toBe("first");
    vi.setSystemTime(START + 30_000);
    expect(await cache.read("k", TTL, GRACE, load)).toBe("first");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves a stale value at once and reloads behind it", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await cache.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 61_000);

    // The caller gets the snapshot without waiting, and the reload goes out behind it.
    expect(await cache.read("k", TTL, GRACE, load)).toBe("first");
    expect(load).toHaveBeenCalledTimes(2);

    await vi.waitFor(async () => expect(await cache.read("k", TTL, GRACE, load)).toBe("second"));
  });

  it("keeps the snapshot ageing when a reload fails, then surfaces the error", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValue(new Error("source gone"));

    await cache.read("k", TTL, GRACE, load);

    // A failed reload restores the entry it replaced, timestamp and all...
    vi.setSystemTime(START + 61_000);
    await expect(cache.read("k", TTL, GRACE, load)).resolves.toBe("first");

    // ...so it keeps ageing rather than hiding a broken source forever.
    vi.setSystemTime(START + 700_000);
    await expect(cache.read("k", TTL, GRACE, load)).rejects.toThrow("source gone");
  });

  it("does not cache a failed first load", async () => {
    const cache = new Cache();
    const load = vi.fn().mockRejectedValueOnce(new Error("source gone")).mockResolvedValue("first");

    await expect(cache.read("k", TTL, GRACE, load)).rejects.toThrow("source gone");
    await expect(cache.read("k", TTL, GRACE, load)).resolves.toBe("first");
  });

  it("serves one load to concurrent callers", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    await Promise.all([cache.read("k", TTL, GRACE, load), cache.read("k", TTL, GRACE, load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("goes back to the source after a clear", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    await cache.read("k", TTL, GRACE, load);
    cache.clear();
    await cache.read("k", TTL, GRACE, load);

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("Cache.revalidate", () => {
  it("reloads a fresh value, serving the old one until the new one lands", async () => {
    const cache = new Cache();
    const second = Promise.withResolvers<string>();
    const load = vi.fn().mockResolvedValueOnce("first").mockReturnValueOnce(second.promise);

    await cache.read("k", TTL, GRACE, load);
    const revalidated = cache.revalidate("k", TTL, load);

    // Well inside its TTL, yet reloaded — and nobody waits on that reload meanwhile.
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });

    second.resolve("second");
    await revalidated;

    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "second" });
  });

  it("leaves a key nobody has read alone", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    await cache.revalidate("k", TTL, load);

    expect(load).not.toHaveBeenCalled();
  });

  it("loads once more behind a load already in flight, however many times it is asked", async () => {
    const cache = new Cache();
    const inFlight = Promise.withResolvers<string>();
    const load = vi.fn().mockReturnValueOnce(inFlight.promise).mockResolvedValueOnce("after the change");

    const read = cache.read("k", TTL, GRACE, load);
    // That load may have left before the change: it is not the answer, one more load is.
    const revalidated = Promise.all([cache.revalidate("k", TTL, load), cache.revalidate("k", TTL, load)]);

    inFlight.resolve("before the change");
    await read;
    await revalidated;

    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "after the change" });
  });

  it("keeps the snapshot when the reload fails, and does not reject", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("source gone"));

    await cache.read("k", TTL, GRACE, load);

    await expect(cache.revalidate("k", TTL, load)).resolves.toBeUndefined();
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
  });
});

describe("Cache.peek", () => {
  it("has nothing before the first load settles", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    expect(cache.peek("k", TTL, GRACE, load)).toBeUndefined();

    await cache.read("k", TTL, GRACE, load);

    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
  });

  it("keeps answering while a reload is in flight", async () => {
    const cache = new Cache();
    let release: (value: string) => void = () => undefined;
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockReturnValueOnce(new Promise<string>(resolve => (release = resolve)));

    await cache.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 61_000);

    // This read starts the reload; the one behind it must not be made to wait for it.
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(load).toHaveBeenCalledTimes(2);

    release("second");
    await vi.waitFor(() => expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "second" }));
  });

  it("gives up once the value is past the grace window", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    await cache.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 700_000);

    expect(cache.peek("k", TTL, GRACE, load)).toBeUndefined();
  });

  it("distinguishes a cached undefined from nothing cached", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue(undefined);

    await cache.read("k", TTL, GRACE, load);

    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: undefined });
  });
});

describe("Cache.define", () => {
  it("serves the same entry as the arguments it bound", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");
    const snapshot = cache.define("k", TTL, GRACE, load);

    expect(snapshot.peek()).toBeUndefined();
    expect(await snapshot.read()).toBe("first");
    expect(snapshot.peek()).toEqual({ data: "first" });

    // The same entry the unbound calls reach: a handle is a spelling, not a second cache.
    expect(cache.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("resolves rather than rejects when warming a source that is down", async () => {
    const cache = new Cache();
    const snapshot = cache.define("k", TTL, GRACE, vi.fn().mockRejectedValue(new Error("source gone")));

    await expect(snapshot.warm()).resolves.toBeUndefined();
  });
});

describe("join", () => {
  it("projects one source, without caching the result a second time", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue(["a", "b"]);
    const source = cache.define<string[]>("k", TTL, GRACE, load);
    const derived = Cache.join(source, rows => rows.length);

    expect(await derived.read()).toBe(2);
    expect(derived.peek()).toEqual({ data: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("combines two sources", async () => {
    const cache = new Cache();
    const a = cache.define("a", TTL, GRACE, vi.fn().mockResolvedValue("first"));
    const b = cache.define("b", TTL, GRACE, vi.fn().mockResolvedValue(2));
    const derived = Cache.join(a, b, (left, right) => `${left}:${right}`);

    expect(derived.peek()).toBeUndefined();
    expect(await derived.read()).toBe("first:2");
    expect(derived.peek()).toEqual({ data: "first:2" });
  });

  it("warms every source", async () => {
    const cache = new Cache();
    const first = vi.fn().mockResolvedValue("first");
    const second = vi.fn().mockRejectedValue(new Error("source gone"));
    const derived = Cache.join(cache.define("a", TTL, GRACE, first), cache.define("b", TTL, GRACE, second), () => 0);

    // Resolves despite the second source being down, and does not skip it because of the first.
    await expect(derived.warm()).resolves.toBeUndefined();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("refreshes every source", async () => {
    const cache = new Cache();
    const first = vi.fn<() => Promise<string>>().mockResolvedValueOnce("a1").mockResolvedValueOnce("a2");
    const second = vi.fn<() => Promise<string>>().mockResolvedValueOnce("b1").mockResolvedValueOnce("b2");
    const derived = Cache.join(
      cache.define("a", TTL, GRACE, first),
      cache.define("b", TTL, GRACE, second),
      (a, b) => a + b,
    );

    await derived.read();
    await derived.refresh();

    expect(derived.peek()).toEqual({ data: "a2b2" });
  });

  it("peeks every source even once one of them is cold", async () => {
    const cache = new Cache();
    const cold = vi.fn().mockResolvedValue("never read");
    const stale = vi.fn().mockResolvedValue("first");
    const a = cache.define("a", TTL, GRACE, cold);
    const b = cache.define("b", TTL, GRACE, stale);

    await b.read();
    vi.setSystemTime(START + 61_000);

    // `a` has nothing, so the join answers `undefined` — but peeking is what starts a stale
    // entry's reload, so giving up at the first cold source would leave `b` ageing untouched.
    expect(Cache.join(a, b, (left, right) => `${String(left)}:${right}`).peek()).toBeUndefined();
    expect(stale).toHaveBeenCalledTimes(2);
  });
});
