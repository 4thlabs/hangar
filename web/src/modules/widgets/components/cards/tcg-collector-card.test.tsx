import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TcgCard, TcgDailyPrices, TcgFollowedCard } from "#libs/api";
import { PriceCurve, TcgCollectorCard } from "./tcg-collector-card.tsx";

const aCard = (overrides: Partial<TcgCard> = {}): TcgCard => ({
  name: "Sol Ring",
  expansion: "Commander Masters",
  version: 2,
  trend: 1.5,
  low: 0.9,
  trendFoil: null,
  ...overrides,
});

const aDay = (day: string, prices: Partial<TcgDailyPrices> = {}): TcgDailyPrices => ({
  day,
  low: 0.9,
  trend: 1.5,
  ...prices,
});

const history = [
  aDay("2026-10-09", { trend: 1.2 }),
  aDay("2026-10-10", { trend: 1.3 }),
  aDay("2026-10-11", { trend: 1.45 }),
];

const solRing: TcgFollowedCard = { game: 1, product: 910771, imageId: "1-910771", card: aCard(), history };

const render = (cards: TcgFollowedCard[], days = 30, link = "https://cards.test.local") =>
  renderToStaticMarkup(<TcgCollectorCard cards={{ days, cards }} placementKey="tcg-collector-cards-k1" link={link} />);

describe("PriceCurve", () => {
  it("places each day by its date in the window, so that a short history fills only its last days", () => {
    const series = PriceCurve.series(history, { days: 5, lastDay: "2026-10-11" });

    expect(series).toEqual({ label: "Trend", prices: [null, null, 1.2, 1.3, 1.45] });
  });

  it("leaves the days after a card's last price empty when another card has more recent ones", () => {
    expect(PriceCurve.series(history, { days: 5, lastDay: "2026-10-13" }).prices).toEqual([1.2, 1.3, 1.45, null, null]);
  });

  it("drops the days before the window", () => {
    expect(PriceCurve.series(history, { days: 2, lastDay: "2026-10-11" }).prices).toEqual([1.3, 1.45]);
  });

  it("falls back to the lowest offer for a card Cardmarket gives no trend", () => {
    const series = PriceCurve.series(
      [aDay("2026-10-10", { trend: null, low: 3 }), aDay("2026-10-11", { trend: null })],
      { days: 2, lastDay: "2026-10-11" },
    );

    expect(series).toEqual({ label: "Low", prices: [3, 0.9] });
  });

  it("reads the curve out over the whole window, from the first known price to the last", () => {
    const series = PriceCurve.series(history, { days: 30, lastDay: "2026-10-11" });

    expect(PriceCurve.describe(series)).toBe("Trend over 30 days: from €1.20 to €1.45");
    expect(PriceCurve.describe({ label: "Trend", prices: [2] })).toBe("Trend over 1 day: €2.00");
  });

  it("finds the most recent priced day across the cards, and none when no card has one", () => {
    const older = { ...solRing, history: [aDay("2026-10-02")] };

    expect(PriceCurve.latestDay([older, solRing])).toBe("2026-10-11");
    expect(PriceCurve.latestDay([{ ...solRing, history: [] }])).toBeUndefined();
  });
});

describe("TcgCollectorCard", () => {
  it("shows the card, its version and expansion, linked to its sheet, its image relayed", () => {
    const html = render([solRing]);

    expect(html).toContain(">Sol Ring</a>");
    expect(html).toContain("V.2");
    expect(html).toContain("Commander Masters");
    expect(html).toContain('href="https://cards.test.local/?game=1&amp;card=910771"');
    expect(html).toContain('src="/api/widgets/tcg-collector-cards-k1/image/1-910771"');
    expect(render([solRing], 30, "https://cards.test.local/")).toContain(
      'href="https://cards.test.local/?game=1&amp;card=910771"',
    );
  });

  it("writes the trend, the low price, the foil trend when there is one, and a dash for an unknown price", () => {
    expect(render([solRing])).toContain("Low €0.90");
    expect(render([solRing])).not.toContain("Foil");

    const html = render([{ ...solRing, card: aCard({ trend: null, trendFoil: 12.5, version: null }) }]);

    expect(html).toContain("Foil €12.50");
    expect(html).toContain("—");
    expect(html).not.toContain("V.");
  });

  it("draws every row on the same days, ending on the most recent priced day of any card", () => {
    const stale = { ...solRing, history: [aDay("2026-10-08", { trend: 1 }), aDay("2026-10-09", { trend: 2 })] };
    const html = render([solRing, stale], 5);

    expect(html).toContain('<polyline points="50,24 75,14.4 100,0"');
    expect(html).toContain('<polyline points="25,24 50,0"');
  });

  it("gives a product tcg-collector does not know a row of its own, and says what the card covers", () => {
    const html = render([solRing, { game: 21, product: 755143, imageId: "21-755143", card: null, history: [] }], 90);

    expect(html).toContain("Card not found");
    expect(html).toContain("Star Wars Unlimited · product 755143");
    expect(html).not.toContain("/image/21-755143");
    expect(html).toContain("2 cards");
    expect(html).toContain("90 days");
    expect(html).toContain("as of Oct 11, 2026");
  });
});
