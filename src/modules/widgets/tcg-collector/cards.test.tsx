import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aService, aWidget, clearWidgetCache } from "../mock/mock.ts";
import type { TcgCard, TcgDailyPrices } from "./api/client.ts";
import { PriceCurve, tcgCollectorCards, TcgCollectorCardsCard, type FollowedCardPrices } from "./cards.tsx";
import { tcgCollectorCardsDescriptor } from "./descriptor.ts";

// The widget cache is process-global, and every widget built here shares one key.
beforeEach(clearWidgetCache);

afterEach(() => vi.unstubAllGlobals());

const service = {
  api: "http://tcg-collector-web:8080",
  link: "https://cards.test.local",
  apiKey: () => Promise.resolve(undefined),
};

const aCard = (overrides: Partial<TcgCard> = {}): TcgCard => ({
  product: "910771",
  name: "Sol Ring",
  single: true,
  expansionId: 5432,
  expansion: "Commander Masters",
  version: 2,
  added: "2023-08-04",
  trend: 1.5,
  low: 0.9,
  trendFoil: null,
  ...overrides,
});

const aDay = (day: string, prices: Partial<TcgDailyPrices> = {}): TcgDailyPrices => ({
  day,
  low: 0.9,
  trend: 1.5,
  avg1: null,
  avg30: null,
  low_foil: null,
  trend_foil: null,
  avg1_foil: null,
  avg30_foil: null,
  ...prices,
});

const history = [
  aDay("2026-10-09", { trend: 1.2 }),
  aDay("2026-10-10", { trend: 1.3 }),
  aDay("2026-10-11", { trend: 1.45 }),
];

const solRing: FollowedCardPrices = { game: 1, product: 910771, card: aCard(), history };

const render = (followed: FollowedCardPrices[], days = 30) =>
  renderToStaticMarkup(
    <TcgCollectorCardsCard
      locale="en"
      followed={followed}
      days={days}
      serviceUrl="https://cards.test.local"
      placementKey="tcg-collector-cards-k1"
    />,
  );

describe("PriceCurve", () => {
  it("places each day by its date in the window, so a short history fills only its last days", () => {
    const series = PriceCurve.series(history, { days: 5, lastDay: "2026-10-11" });

    expect(series).toEqual({ label: "trend", prices: [null, null, 1.2, 1.3, 1.45] });
  });

  it("leaves the days after a card's last price empty when another card has more recent ones", () => {
    expect(PriceCurve.series(history, { days: 5, lastDay: "2026-10-13" }).prices).toEqual([1.2, 1.3, 1.45, null, null]);
  });

  it("drops the days before the window, such as the extra day tcg-collector's period may start with", () => {
    expect(PriceCurve.series(history, { days: 2, lastDay: "2026-10-11" }).prices).toEqual([1.3, 1.45]);
  });

  it("falls back to the lowest offer for a card Cardmarket gives no trend", () => {
    const series = PriceCurve.series(
      [aDay("2026-10-10", { trend: null, low: 3 }), aDay("2026-10-11", { trend: null })],
      { days: 2, lastDay: "2026-10-11" },
    );

    expect(series).toEqual({ label: "low", prices: [3, 0.9] });
  });

  it("reads the curve out over the whole window, from the first known price to the last", () => {
    const series = PriceCurve.series(history, { days: 30, lastDay: "2026-10-11" });

    expect(PriceCurve.describe(series, "en")).toBe("Trend over 30 days: from €1.20 to €1.45");
  });

  it("describes a single day by its one price", () => {
    expect(PriceCurve.describe({ label: "trend", prices: [2] }, "en")).toBe("Trend over 1 day: €2.00");
  });

  it("finds the most recent priced day across the cards, and none when no card has one", () => {
    const older = { ...solRing, history: [aDay("2026-10-02")] };

    expect(PriceCurve.latestDay([older, solRing])).toBe("2026-10-11");
    expect(PriceCurve.latestDay([{ ...solRing, history: [] }])).toBeUndefined();
  });
});

describe("TcgCollectorCardsCard", () => {
  it("shows the card, its version and expansion, linked to its sheet on the tcg-collector page", () => {
    const html = render([solRing]);

    expect(html).toContain(">Sol Ring</a>");
    expect(html).toContain("V.2");
    expect(html).toContain("Commander Masters");
    expect(html).toContain('href="https://cards.test.local/?game=1&amp;card=910771"');
    // Both parts in the relay id: a product id is only unique within its game.
    expect(html).toContain('src="/api/widgets/tcg-collector-cards-k1/image/1-910771"');
  });

  it("links to the card's sheet even when `link` ends with a slash", () => {
    const html = renderToStaticMarkup(
      <TcgCollectorCardsCard
        locale="en"
        followed={[solRing]}
        days={30}
        serviceUrl="https://cards.test.local/"
        placementKey="tcg-collector-cards-k1"
      />,
    );

    expect(html).toContain('href="https://cards.test.local/?game=1&amp;card=910771"');
  });

  it("puts the trend first and the low price after it, and no foil price for a card with no foil", () => {
    const html = render([solRing]);

    expect(html).toContain("€1.50");
    expect(html).toContain("Low €0.90");
    expect(html).not.toContain("Foil");
  });

  it("writes the foil trend when there is one, and a dash for an unknown price", () => {
    const html = render([{ ...solRing, card: aCard({ trend: null, trendFoil: 12.5, version: null }) }]);

    expect(html).toContain("Foil €12.50");
    expect(html).toContain("—");
    expect(html).not.toContain("V.");
  });

  it("draws the curve in the text color over the declared period, with what it shows as its label", () => {
    const html = render([solRing]);

    // Three days of a 30-day period: the last tenth of the width, not all of it.
    expect(html).toContain('<polyline points="93.1,24 96.55,14.4 100,0"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-label="Trend over 30 days: from €1.20 to €1.45"');
  });

  it("draws every row on the same days, ending on the most recent priced day of any card", () => {
    const stale = { ...solRing, history: [aDay("2026-10-08", { trend: 1 }), aDay("2026-10-09", { trend: 2 })] };
    const html = render([solRing, stale], 5);

    expect(html).toContain('<polyline points="50,24 75,14.4 100,0"');
    // Its last two days are empty: the curve stops where its prices do, not at the right edge.
    expect(html).toContain('<polyline points="25,24 50,0"');
  });

  it("draws no curve for a card with no price history yet", () => {
    const html = render([{ ...solRing, history: [] }]);

    expect(html).toContain("Sol Ring");
    expect(html).not.toContain("<polyline");
  });

  it("gives a product tcg-collector does not know a row of its own, among the cards it does", () => {
    const html = render([solRing, { game: 21, product: 755143, card: null, history: [] }]);

    expect(html).toContain("Sol Ring");
    expect(html).toContain("Card not found");
    expect(html).toContain("Star Wars Unlimited · product 755143");
    // Nothing to show, so nothing to relay.
    expect(html).not.toContain("/image/21-755143");
  });

  it("keeps the declared order, even when a card is listed twice", () => {
    const bolt = { game: 1, product: 1, card: aCard({ name: "Lightning Bolt" }), history };
    const html = render([bolt, solRing, bolt]);

    expect(html.indexOf("Lightning Bolt")).toBeLessThan(html.indexOf("Sol Ring"));
    expect(html.split("Lightning Bolt").length - 1).toBe(2);
  });

  it("says how many cards, over which period, and the most recent day it has prices for", () => {
    const html = render([solRing, { game: 21, product: 755143, card: null, history: [] }], 90);

    expect(html).toContain("2 cards");
    expect(html).toContain("90 days");
    expect(html).toContain("as of Oct 11, 2026");
  });
});

describe("tcgCollectorCards", () => {
  /** Answers each card call from `cards` by product, and every daily call with `history`. */
  const stub = (cards: Record<string, TcgCard | null>) => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);
      const url = new URL(request.url);

      const body = url.pathname.endsWith("/card")
        ? { card: cards[url.searchParams.get("product")!] ?? null }
        : { days: history };

      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    });

    return called;
  };

  it("loads every card and its days from the container, and points the browser at the public page", async () => {
    const called = stub({ "910771": aCard(), "755143": aCard({ product: "755143", name: "Luke Skywalker" }) });

    const { Widget } = aWidget(
      tcgCollectorCardsDescriptor,
      tcgCollectorCards(service, {
        cards: [
          { game: 1, product: 910771 },
          { game: 21, product: 755143 },
        ],
        days: 30,
      }),
    );

    const html = renderToStaticMarkup(<>{await Widget({ locale: "en" })}</>);

    expect(called.map(request => request.url).sort()).toEqual([
      "http://tcg-collector-web:8080/api/card?game=1&product=910771",
      "http://tcg-collector-web:8080/api/card?game=21&product=755143",
      "http://tcg-collector-web:8080/api/daily?game=1&product=910771&days=30",
      "http://tcg-collector-web:8080/api/daily?game=21&product=755143&days=30",
    ]);

    // tcg-collector takes no key, and Hangar sends no header when there is none.
    expect(called.every(request => request.headers.get("x-api-key") === null)).toBe(true);
    expect(html.indexOf("Sol Ring")).toBeLessThan(html.indexOf("Luke Skywalker"));
    expect(html).toContain("https://cards.test.local/?game=21&amp;card=755143");
    expect(html).not.toContain("tcg-collector-web:8080");
  });

  it("renders the cards it knows when one product is unknown", async () => {
    stub({ "910771": aCard() });

    const { Widget } = aWidget(
      tcgCollectorCardsDescriptor,
      tcgCollectorCards(service, {
        cards: [
          { game: 1, product: 910771 },
          { game: 1, product: 42 },
        ],
        days: 30,
      }),
    );

    const html = renderToStaticMarkup(<>{await Widget({ locale: "en" })}</>);

    expect(html).toContain("Sol Ring");
    expect(html).toContain("Magic · product 42");
  });

  it("degrades to the error card when tcg-collector fails to answer", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ error: "The server could not answer" }, { status: 500 })),
    );

    const { Widget } = aWidget(
      tcgCollectorCardsDescriptor,
      tcgCollectorCards(service, { cards: [{ game: 1, product: 910771 }], days: 30 }),
    );

    const html = renderToStaticMarkup(<>{await Widget({ locale: "en" })}</>);

    expect(html).toContain("TCG Collector is unavailable");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = aWidget(
      tcgCollectorCardsDescriptor,
      tcgCollectorCards(aService(), { cards: [{ game: 1, product: 1 }], days: 30 }),
    );

    expect(renderToStaticMarkup(<Skeleton locale="en" />)).toContain("TCG Collector");
  });
});
