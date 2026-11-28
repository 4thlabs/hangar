import { describe, expect, it } from "vitest";
import type { FinnhubQuote } from "#libs/api";
import { finnhubView } from "./finnhub-view.ts";

function quote(symbol: string): FinnhubQuote {
  return { symbol, price: 1, changePercent: 0, high: 1, low: 1, open: 1 };
}

describe("finnhubView", () => {
  it("joins each quote to its profile and closes, in the order of the quotes, a stock without them bare", () => {
    const view = finnhubView(
      [quote("AIR.PA"), quote("AAPL")],
      [
        { symbol: "AAPL", name: "Apple Inc", currency: "USD" },
        { symbol: "NOPE", name: null, currency: null },
      ],
      [{ symbol: "AAPL", closes: [180, 190.5] }],
    );

    expect(view.map(stock => [stock.symbol, stock.name, stock.currency, stock.closes])).toEqual([
      ["AIR.PA", null, null, []],
      ["AAPL", "Apple Inc", "USD", [180, 190.5]],
    ]);
  });
});
