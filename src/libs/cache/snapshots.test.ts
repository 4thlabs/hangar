import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Snapshots } from "./snapshots.ts";

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
