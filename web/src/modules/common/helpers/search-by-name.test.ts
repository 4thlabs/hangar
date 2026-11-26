import { describe, expect, it } from "vitest";
import { searchByName } from "./search-by-name.ts";

const apps = [{ name: "Miniflux" }, { name: "jellyfin" }, { name: "Frigate" }];

describe("searchByName", () => {
  it("sorts every item by name for an empty query", () => {
    expect(searchByName("", apps).map(app => app.name)).toEqual(["Frigate", "jellyfin", "Miniflux"]);
  });

  it("keeps the names the query is a subsequence of", () => {
    expect(searchByName("jfin", apps).map(app => app.name)).toEqual(["jellyfin"]);
    expect(searchByName("zzz", apps)).toEqual([]);
  });
});
