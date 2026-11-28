import { describe, expect, it } from "vitest";
import type { JellyfinItem } from "#libs/api";
import { jellyfinView } from "./jellyfin-view.ts";

function item(id: string, kind: string, fields: Partial<JellyfinItem> = {}): JellyfinItem {
  return {
    id,
    kind,
    name: `name of ${id}`,
    seriesId: null,
    seriesName: null,
    albumArtist: null,
    productionYear: null,
    imageId: `poster.${id}`,
    ...fields,
  };
}

describe("jellyfinView", () => {
  it("shows an episode as its series, an album by its artist and a movie by its year", () => {
    const posters = jellyfinView([
      item("e1", "Episode", { seriesId: "s1", seriesName: "A Show", imageId: "poster.s1" }),
      item("a1", "MusicAlbum", { albumArtist: "A Band", imageId: null }),
      item("m1", "Movie", { productionYear: 2024 }),
    ]);

    expect(posters).toEqual([
      { id: "s1", imageId: "poster.s1", title: "A Show", subtitle: null },
      { id: "a1", imageId: null, title: "name of a1", subtitle: "A Band" },
      { id: "m1", imageId: "poster.m1", title: "name of m1", subtitle: "2024" },
    ]);
  });

  it("shows a series once, however many of its episodes came", () => {
    const posters = jellyfinView([
      item("e1", "Episode", { seriesId: "s1", seriesName: "A Show" }),
      item("m1", "Movie"),
      item("e2", "Episode", { seriesId: "s1", seriesName: "A Show" }),
    ]);

    expect(posters.map(poster => poster.id)).toEqual(["s1", "m1"]);
  });

  it("shows the first ten posters, newest first", () => {
    const latest = Array.from({ length: 30 }, (_, index) => item(`m${index}`, "Movie"));

    expect(jellyfinView(latest).map(poster => poster.id)).toEqual(latest.slice(0, 10).map(movie => movie.id));
  });

  it("counts the ten posters once each series is shown once", () => {
    const episode = (id: string) => item(id, "Episode", { seriesId: "s1", seriesName: "A Show" });
    const movies = Array.from({ length: 10 }, (_, index) => item(`m${index}`, "Movie"));

    expect(jellyfinView([episode("e1"), episode("e2"), ...movies]).map(poster => poster.id)).toEqual([
      "s1",
      ...movies.slice(0, 9).map(movie => movie.id),
    ]);
  });
});
