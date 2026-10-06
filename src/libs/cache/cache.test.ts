import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache.ts";
import { peek } from "./settled.ts";

vi.mock("#libs/logs", () => ({ logger: { warn: vi.fn() } }));

/** A fixed point to move away from. */
const START = 1_700_000_000_000;

const POLICY = { ttl: 60_000, maxStale: 600_000 };

/** Only `Date` is faked by default: every `await` in here still settles on real microtasks. */
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));
afterEach(() => vi.useRealTimers());

describe("Cache.get", () => {
  it("serves a fresh value without going back to the source", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    expect(await cache.get("k", POLICY, load)).toBe("first");
    vi.setSystemTime(START + 30_000);
    expect(await cache.get("k", POLICY, load)).toBe("first");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands out the same promise, settled, once the value is loaded", async () => {
    const cache = new Cache();
    const first = cache.get("k", POLICY, () => Promise.resolve("first"));

    await first;

    const second = cache.get("k", POLICY, () => Promise.resolve("other"));

    // Settled is what lets React render it without painting the Suspense fallback.
    expect(second).toBe(first);
    expect(peek(second)).toEqual({ value: "first" });
  });

  it("serves a stale value at once and reloads behind it", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await cache.get("k", POLICY, load);
    vi.setSystemTime(START + 61_000);

    expect(peek(cache.get("k", POLICY, load))).toEqual({ value: "first" });
    expect(load).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(peek(cache.get("k", POLICY, load))).toEqual({ value: "second" }));
  });

  it("waits for the source once the value is past its maxStale", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await cache.get("k", POLICY, load);
    vi.setSystemTime(START + 700_000);

    const reloading = cache.get("k", POLICY, load);

    expect(peek(reloading)).toBeUndefined();
    expect(await reloading).toBe("second");
  });

  it("keeps the last good value when a reload fails, then surfaces the error past maxStale", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValue(new Error("source gone"));

    await cache.get("k", POLICY, load);

    vi.setSystemTime(START + 61_000);
    await expect(cache.get("k", POLICY, load)).resolves.toBe("first");

    // The failed reload left the value ageing rather than hiding a broken source forever.
    vi.setSystemTime(START + 700_000);
    await expect(cache.get("k", POLICY, load)).rejects.toThrow("source gone");
  });

  it("does not cache a failed first load", async () => {
    const cache = new Cache();
    const load = vi.fn().mockRejectedValueOnce(new Error("source gone")).mockResolvedValue("first");

    await expect(cache.get("k", POLICY, load)).rejects.toThrow("source gone");
    await expect(cache.get("k", POLICY, load)).resolves.toBe("first");
  });

  it("serves one load to concurrent readers", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("first");

    await Promise.all([cache.get("k", POLICY, load), cache.get("k", POLICY, load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("Cache.refresh", () => {
  it("reloads every value under the prefix and keeps serving the old one meanwhile", async () => {
    const cache = new Cache();
    let answer = "first";
    const load = vi.fn(() => Promise.resolve(answer));

    await cache.get("docker:containers", POLICY, load);
    await cache.get("widget:clock", POLICY, () => Promise.resolve("tick"));
    answer = "second";

    const refreshed = cache.refresh("docker:");

    expect(peek(cache.get("docker:containers", POLICY, load))).toEqual({ value: "first" });
    await refreshed;
    expect(peek(cache.get("docker:containers", POLICY, load))).toEqual({ value: "second" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads once more after a load in flight, which may predate the change", async () => {
    const cache = new Cache();
    let release: (value: string) => void = () => undefined;

    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(new Promise(resolve => (release = resolve)))
      .mockResolvedValue("after the change");

    const first = cache.get("k", POLICY, load);
    const refreshed = Promise.all([cache.refresh("k"), cache.refresh("k")]);

    release("before the change");
    await first;
    await refreshed;

    // One load queued behind the first, shared by both refreshes.
    expect(load).toHaveBeenCalledTimes(2);
    expect(peek(cache.get("k", POLICY, load))).toEqual({ value: "after the change" });
  });

  it("leaves alone a value nobody has read", async () => {
    const cache = new Cache();

    await expect(cache.refresh("k")).resolves.toBeUndefined();
  });

  it("resolves rather than rejects when the reload fails, keeping the old value", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValueOnce("first").mockRejectedValue(new Error("source gone"));

    await cache.get("k", POLICY, load);

    await expect(cache.refresh("k")).resolves.toBeUndefined();
    expect(peek(cache.get("k", POLICY, load))).toEqual({ value: "first" });
  });
});

describe("Cache.keepWarm", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] }).setSystemTime(START));

  it("reloads a value before it goes stale, so no reader meets a stale one", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("value");
    const stop = cache.keepWarm(30_000);

    await cache.get("k", POLICY, load);

    // At 30 s the value would be stale before the next tick at 60 s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("leaves a value alone while it stays fresh past the next tick", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("value");
    const stop = cache.keepWarm(10_000);

    await cache.get("k", POLICY, load);
    await vi.advanceTimersByTimeAsync(40_000);

    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("Cache.clear", () => {
  it("forgets only the values under the prefix", async () => {
    const cache = new Cache();
    const load = vi.fn().mockResolvedValue("value");

    await cache.get("widget:a", POLICY, load);
    await cache.get("docker:a", POLICY, load);
    cache.clear("widget:");
    await cache.get("widget:a", POLICY, load);
    await cache.get("docker:a", POLICY, load);

    expect(load).toHaveBeenCalledTimes(3);
  });
});
