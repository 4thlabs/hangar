import { describe, expect, it } from "vitest";
import { widgetsMessages } from "./messages.ts";

describe("widgetsMessages", () => {
  it("counts Jellyfin's library in the singular for one", () => {
    const { movies, shows, episodes, songs } = widgetsMessages.jellyfin;

    expect([movies({ count: 1 }), shows({ count: 1 }), episodes({ count: 1 }), songs({ count: 1 })]).toEqual([
      "1 movie",
      "1 show",
      "1 episode",
      "1 song",
    ]);

    expect([movies({ count: 2 }), shows({ count: 2 }), episodes({ count: 2 }), songs({ count: 2 })]).toEqual([
      "2 movies",
      "2 shows",
      "2 episodes",
      "2 songs",
    ]);
  });
});
