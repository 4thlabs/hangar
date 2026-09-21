import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, Snapshots } from "./snapshots.ts";

/** A fixed point to move away from; nothing here is on a timer, the class only reads the clock. */
const START = 1_700_000_000_000;

const TTL = 60_000;
const GRACE = 600_000;

/** Only `Date` is faked: every `await` in here still settles on real microtasks. */
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));
afterEach(() => vi.useRealTimers());

describe("Snapshots", () => {
  it("serves a fresh value without going back to the source", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");

    expect(await snapshots.read("k", TTL, GRACE, load)).toBe("first");
    vi.setSystemTime(START + 30_000);
    expect(await snapshots.read("k", TTL, GRACE, load)).toBe("first");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves a stale value at once and reloads behind it", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await snapshots.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 61_000);

    // The caller gets the snapshot without waiting, and the reload goes out behind it.
    expect(await snapshots.read("k", TTL, GRACE, load)).toBe("first");
    expect(load).toHaveBeenCalledTimes(2);

    await vi.waitFor(async () => expect(await snapshots.read("k", TTL, GRACE, load)).toBe("second"));
  });

  it("keeps the snapshot ageing when a reload fails, then surfaces the error", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValue(new Error("source gone"));

    await snapshots.read("k", TTL, GRACE, load);

    // A failed reload restores the entry it replaced, timestamp and all...
    vi.setSystemTime(START + 61_000);
    await expect(snapshots.read("k", TTL, GRACE, load)).resolves.toBe("first");

    // ...so it keeps ageing rather than hiding a broken source forever.
    vi.setSystemTime(START + 700_000);
    await expect(snapshots.read("k", TTL, GRACE, load)).rejects.toThrow("source gone");
  });

  it("does not cache a failed first load", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockRejectedValueOnce(new Error("source gone")).mockResolvedValue("first");

    await expect(snapshots.read("k", TTL, GRACE, load)).rejects.toThrow("source gone");
    await expect(snapshots.read("k", TTL, GRACE, load)).resolves.toBe("first");
  });

  it("serves one load to concurrent callers", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");

    await Promise.all([snapshots.read("k", TTL, GRACE, load), snapshots.read("k", TTL, GRACE, load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("goes back to the source after a clear", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");

    await snapshots.read("k", TTL, GRACE, load);
    snapshots.clear();
    await snapshots.read("k", TTL, GRACE, load);

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("Snapshots.peek", () => {
  it("has nothing before the first load settles", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");

    expect(snapshots.peek("k", TTL, GRACE, load)).toBeUndefined();

    await snapshots.read("k", TTL, GRACE, load);

    expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
  });

  it("keeps answering while a reload is in flight", async () => {
    const snapshots = new Snapshots();
    let release: (value: string) => void = () => undefined;
    const load = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockReturnValueOnce(new Promise<string>(resolve => (release = resolve)));

    await snapshots.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 61_000);

    // This read starts the reload; the one behind it must not be made to wait for it.
    expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(load).toHaveBeenCalledTimes(2);

    release("second");
    await vi.waitFor(() => expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: "second" }));
  });

  it("gives up once the value is past the grace window", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");

    await snapshots.read("k", TTL, GRACE, load);
    vi.setSystemTime(START + 700_000);

    expect(snapshots.peek("k", TTL, GRACE, load)).toBeUndefined();
  });

  it("distinguishes a cached undefined from nothing cached", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue(undefined);

    await snapshots.read("k", TTL, GRACE, load);

    expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: undefined });
  });
});

describe("Snapshots.define", () => {
  it("serves the same entry as the arguments it bound", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue("first");
    const snapshot = snapshots.define("k", TTL, GRACE, load);

    expect(snapshot.peek()).toBeUndefined();
    expect(await snapshot.read()).toBe("first");
    expect(snapshot.peek()).toEqual({ data: "first" });

    // The same entry the unbound calls reach: a handle is a spelling, not a second cache.
    expect(snapshots.peek("k", TTL, GRACE, load)).toEqual({ data: "first" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("resolves rather than rejects when warming a source that is down", async () => {
    const snapshots = new Snapshots();
    const snapshot = snapshots.define("k", TTL, GRACE, vi.fn().mockRejectedValue(new Error("source gone")));

    await expect(snapshot.warm()).resolves.toBeUndefined();
  });
});

describe("join", () => {
  it("projects one source, without caching the result a second time", async () => {
    const snapshots = new Snapshots();
    const load = vi.fn().mockResolvedValue(["a", "b"]);
    const source = snapshots.define<string[]>("k", TTL, GRACE, load);
    const derived = join(source, rows => rows.length);

    expect(await derived.read()).toBe(2);
    expect(derived.peek()).toEqual({ data: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("combines two sources", async () => {
    const snapshots = new Snapshots();
    const a = snapshots.define("a", TTL, GRACE, vi.fn().mockResolvedValue("first"));
    const b = snapshots.define("b", TTL, GRACE, vi.fn().mockResolvedValue(2));
    const derived = join(a, b, (left, right) => `${left}:${right}`);

    expect(derived.peek()).toBeUndefined();
    expect(await derived.read()).toBe("first:2");
    expect(derived.peek()).toEqual({ data: "first:2" });
  });

  it("warms every source", async () => {
    const snapshots = new Snapshots();
    const first = vi.fn().mockResolvedValue("first");
    const second = vi.fn().mockRejectedValue(new Error("source gone"));
    const derived = join(snapshots.define("a", TTL, GRACE, first), snapshots.define("b", TTL, GRACE, second), () => 0);

    // Resolves despite the second source being down, and does not skip it because of the first.
    await expect(derived.warm()).resolves.toBeUndefined();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("peeks every source even once one of them is cold", async () => {
    const snapshots = new Snapshots();
    const cold = vi.fn().mockResolvedValue("never read");
    const stale = vi.fn().mockResolvedValue("first");
    const a = snapshots.define("a", TTL, GRACE, cold);
    const b = snapshots.define("b", TTL, GRACE, stale);

    await b.read();
    vi.setSystemTime(START + 61_000);

    // `a` has nothing, so the join answers `undefined` — but peeking is what starts a stale
    // entry's reload, so giving up at the first cold source would leave `b` ageing untouched.
    expect(join(a, b, (left, right) => `${String(left)}:${right}`).peek()).toBeUndefined();
    expect(stale).toHaveBeenCalledTimes(2);
  });
});
