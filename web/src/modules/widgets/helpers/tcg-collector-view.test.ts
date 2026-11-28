import { describe, expect, it } from "vitest";
import { tcgCollectorView } from "./tcg-collector-view.ts";

describe("tcgCollectorView", () => {
  it("gives each card its curve, by its game and product, and none to a card with no prices", () => {
    const view = tcgCollectorView(
      [
        { game: 21, product: 7, imageId: "card.21-7", card: null },
        { game: 1, product: 7, imageId: "card.1-7", card: null },
      ],
      { days: 14, cards: [{ game: 21, product: 7, history: [{ day: "2026-11-24", trend: 12, low: 9.5 }] }] },
    );

    expect(view.days).toBe(14);
    expect(view.cards.map(card => card.history.length)).toEqual([1, 0]);
  });
});
