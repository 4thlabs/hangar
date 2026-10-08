import { describe, expect, it } from "vitest";
import type { HangarApp } from "#libs/hangar";
import { StoreCatalog } from "./listing.ts";

const app = (id: string, installed: boolean) => ({ id, name: id, installed }) as HangarApp;
const all = [app("alpha", true), app("beta", false), app("gamma", false)];

describe("StoreCatalog.list", () => {
  it("keeps every app when no filter is ticked", () => {
    expect(StoreCatalog.list(all, { q: "", filter: [] }).apps.map(item => item.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("keeps only the apps of the ticked filter, then applies the name search", () => {
    expect(StoreCatalog.list(all, { q: "gam", filter: ["available"] }).apps.map(item => item.id)).toEqual(["gamma"]);
  });

  it("counts each filter over every app, whatever the search", () => {
    expect(StoreCatalog.list(all, { q: "alpha", filter: ["installed"] }).counts).toEqual({
      installed: 1,
      available: 2,
    });
  });
});
