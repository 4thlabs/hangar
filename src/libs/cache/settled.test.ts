import { describe, expect, it } from "vitest";
import { all, fulfilled, map, peek, recover, track } from "./settled.ts";

/** A promise that settles on a later tick, as a real load does. */
const later = <T>(value: T) => track(new Promise<T>(resolve => setTimeout(() => resolve(value), 0)));

/** A promise already rejected and marked so, as a cached failure is. Boxed, or `await` would unwrap it. */
const failedWith = async (reason: Error) => {
  const promise = track(Promise.reject(reason));

  await promise.catch(() => undefined);

  return { promise };
};

describe("track", () => {
  it("marks a promise with its value once it settles", async () => {
    const promise = track(Promise.resolve("value"));

    expect(peek(promise)).toBeUndefined();
    await promise;
    expect(peek(promise)).toEqual({ value: "value" });
  });

  it("marks a rejection, which peek rethrows", async () => {
    const { promise } = await failedWith(new Error("source gone"));

    expect(() => peek(promise)).toThrow("source gone");
  });
});

describe("map", () => {
  it("derives a settled value in the same call when its source is settled", () => {
    expect(peek(map(fulfilled(2), value => value * 3))).toEqual({ value: 6 });
  });

  it("derives once the source settles when it is still pending", async () => {
    const derived = map(later(2), value => value * 3);

    expect(peek(derived)).toBeUndefined();
    expect(await derived).toBe(6);
  });

  it("rejects at once when the projection throws", () => {
    const derived = map(fulfilled(2), () => {
      throw new Error("bad shape");
    });

    expect(() => peek(derived)).toThrow("bad shape");
  });

  it("rejects at once when the source already failed", async () => {
    const derived = map((await failedWith(new Error("source gone"))).promise, () => "never");

    expect(() => peek(derived)).toThrow("source gone");
  });
});

describe("all", () => {
  it("is settled in the same call when every source is", () => {
    expect(peek(all([fulfilled(1), fulfilled("a")]))).toEqual({ value: [1, "a"] });
  });

  it("waits for the sources still pending", async () => {
    const both = all([fulfilled(1), later("a")]);

    expect(peek(both)).toBeUndefined();
    expect(await both).toEqual([1, "a"]);
  });
});

describe("recover", () => {
  it("replaces a failure already known in the same call", async () => {
    const recovered = recover((await failedWith(new Error("source gone"))).promise, () => "fallback");

    expect(peek(recovered)).toEqual({ value: "fallback" });
  });

  it("passes a settled value through untouched", () => {
    const source = fulfilled("value");

    expect(recover(source, () => "fallback")).toBe(source);
  });

  it("replaces a failure that comes later", async () => {
    const pending = track(Promise.reject(new Error("source gone")));

    await expect(recover(pending, () => "fallback")).resolves.toBe("fallback");
  });
});
