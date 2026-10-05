import { describe, expect, it } from "vitest";
import type { HangarApp } from "#libs/hangar";
import { storeListing } from "./listing.ts";

const app = (id: string, installed: boolean) => ({ id, name: id, installed }) as HangarApp;
const all = [app("alpha", true), app("beta", false), app("gamma", false)];

describe("storeListing", () => {
  it("keeps every app when no filter is ticked", () => {
    expect(storeListing(all, { q: "", filter: [] }).apps.map(item => item.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("keeps only the apps of the ticked filter, then applies the name search", () => {
    expect(storeListing(all, { q: "gam", filter: ["available"] }).apps.map(item => item.id)).toEqual(["gamma"]);
  });

  it("counts each filter over every app, whatever the search", () => {
    expect(storeListing(all, { q: "alpha", filter: ["installed"] }).counts).toEqual({ installed: 1, available: 2 });
  });
});
