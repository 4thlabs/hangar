import { describe, expect, it } from "vitest";
import { countBy } from "./count-by.ts";

describe("countBy", () => {
  it("counts the items carrying each value, skipping those the key does not apply to", () => {
    const words = ["apple", "avocado", "banana", ""];

    expect(countBy(words, word => word[0])).toEqual({ a: 2, b: 1 });
  });

  it("counts values named like Object.prototype members", () => {
    const counts = countBy(["constructor", "__proto__", "constructor"], name => name);

    expect(Object.keys(counts).sort()).toEqual(["__proto__", "constructor"]);
    expect(counts["constructor"]).toBe(2);
    expect(Object.getOwnPropertyDescriptor(counts, "__proto__")?.value).toBe(1);
  });
});
