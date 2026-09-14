import { describe, expect, it } from "vitest";
import { searchByName } from "#app/search.ts";

const apps = [{ name: "Immich" }, { name: "Nextcloud" }, { name: "Audiobookshelf" }];

describe("searchByName", () => {
  it("orders alphabetically when there is no query", () => {
    expect(searchByName("", apps).map(app => app.name)).toEqual(["Audiobookshelf", "Immich", "Nextcloud"]);
  });

  it("does not mutate the input while sorting", () => {
    searchByName("", apps);

    expect(apps.map(app => app.name)).toEqual(["Immich", "Nextcloud", "Audiobookshelf"]);
  });

  it("keeps only what matches, ordered by relevance", () => {
    expect(searchByName("cloud", apps).map(app => app.name)).toEqual(["Nextcloud"]);
  });

  it("matches a subsequence, not just a substring", () => {
    expect(searchByName("nxtcld", apps).map(app => app.name)).toEqual(["Nextcloud"]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(searchByName("zzz", apps)).toEqual([]);
  });
});
