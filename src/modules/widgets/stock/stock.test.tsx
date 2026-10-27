import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aWidget } from "../mock/mock.ts";
import type { Stock } from "./api/client.ts";
import { stockPricesDescriptor } from "./descriptor.ts";
import { stockPrices, StocksCard } from "./stock.tsx";

const aStock = (overrides: Partial<Stock>): Stock => ({
  symbol: "AAPL",
  name: "Apple Inc",
  currency: "USD",
  price: 230,
  changePercent: 1.5,
  high: 232,
  low: 228,
  open: 229,
  closes: [],
  ...overrides,
});

const apple = aStock({ closes: [220, 225, 230] });
const airbus = aStock({ symbol: "AIR.PA", name: "Airbus SE", currency: "EUR", price: 140, changePercent: -2 });

describe("StocksCard", () => {
  it("prices each stock in the currency it is quoted in, with its signed change", () => {
    const html = renderToStaticMarkup(<StocksCard stocks={[apple, airbus]} />);

    expect(html).toContain("Apple Inc");
    expect(html).toContain("$230.00");
    expect(html).toContain("+1.50%");
    expect(html).toContain("Airbus SE");
    expect(html).toContain("€140.00");
    expect(html).toContain("-2.00%");
  });

  it("names the best and worst stocks of the day, and adds no prices across currencies", () => {
    const html = renderToStaticMarkup(<StocksCard stocks={[apple, airbus]} />);

    expect(html).toMatch(/Best.*\+1\.50%.*AAPL/);
    expect(html).toMatch(/Worst.*-2\.00%.*AIR\.PA/);
    expect(html).not.toContain("Avg");
  });

  it("does not show a flat day as a loss", () => {
    const html = renderToStaticMarkup(<StocksCard stocks={[aStock({ changePercent: 0 })]} />);

    expect(html).toContain("0.00%");
    expect(html).not.toContain("text-destructive");
  });

  it("draws the curve of a stock that has closes, and none for one without", () => {
    const html = renderToStaticMarkup(<StocksCard stocks={[apple, airbus]} />);

    expect(html).toContain('aria-label="Closes over the last month: from $220.00 to $230.00"');
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("shows a bare price for a stock Finnhub has no profile for", () => {
    const html = renderToStaticMarkup(<StocksCard stocks={[aStock({ name: undefined, currency: undefined })]} />);

    expect(html).toContain(">230.00<");
    expect(html).not.toContain("Apple Inc");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = aWidget(stockPricesDescriptor, stockPrices(["AAPL"]));
    const html = renderToStaticMarkup(<Skeleton />);

    expect(html).toContain("Stocks");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("stockPricesDescriptor", () => {
  const declaration = (tickers: string[]) => ({ type: "stock-prices", column: 3, tickers });

  it("accepts share classes and listings outside the US", () => {
    expect(stockPricesDescriptor.schema.safeParse(declaration(["BRK.B", "AIR.PA", "005930.KS"])).success).toBe(true);
  });

  it("rejects a lowercase symbol and a repeated one", () => {
    expect(stockPricesDescriptor.schema.safeParse(declaration(["aapl"])).success).toBe(false);
    expect(stockPricesDescriptor.schema.safeParse(declaration(["AAPL", "AAPL"])).success).toBe(false);
  });
});
