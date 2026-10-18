import { describe, expect, it } from "vitest";
import { ToggledSet } from "./toggled-set.ts";

describe("ToggledSet.create", () => {
  it("adds or removes the value in a copy, leaving the original untouched", () => {
    const current = new Set(["alpha"]);

    expect([...ToggledSet.create(current, "beta", true)]).toEqual(["alpha", "beta"]);
    expect([...ToggledSet.create(current, "alpha", false)]).toEqual([]);
    expect([...current]).toEqual(["alpha"]);
  });
});
