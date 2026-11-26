import { describe, expect, it } from "vitest";
import { NameSearch } from "./search.ts";

const apps = [{ name: "Miniflux" }, { name: "jellyfin" }, { name: "Frigate" }];

describe("NameSearch.apply", () => {
  it("sorts every item by name for an empty query", () => {
    expect(NameSearch.apply("", apps).map(app => app.name)).toEqual(["Frigate", "jellyfin", "Miniflux"]);
  });

  it("keeps the names the query is a subsequence of", () => {
    expect(NameSearch.apply("jfin", apps).map(app => app.name)).toEqual(["jellyfin"]);
    expect(NameSearch.apply("zzz", apps)).toEqual([]);
  });
});
