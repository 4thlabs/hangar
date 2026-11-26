import { describe, expect, it } from "vitest";
import { toggledSet } from "./toggled-set.ts";

describe("toggledSet", () => {
  it("adds or removes the value in a copy, leaving the original untouched", () => {
    const current = new Set(["alpha"]);

    expect([...toggledSet(current, "beta", true)]).toEqual(["alpha", "beta"]);
    expect([...toggledSet(current, "alpha", false)]).toEqual([]);
    expect([...current]).toEqual(["alpha"]);
  });
});
