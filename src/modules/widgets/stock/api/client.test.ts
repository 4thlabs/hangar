import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "#libs/cache";
import { logger } from "#libs/logs";
import { FinnhubClient } from "./client.ts";

/** What Finnhub answers on each endpoint for one symbol: a body, or an HTTP status to fail with. */
type SymbolAnswers = Partial<Record<"quote" | "stock/profile2" | "stock/candle", object | number>>;

const quote = (price: number, changePercent: number) => ({ c: price, dp: changePercent, h: 232, l: 228, o: 229 });

/** How Finnhub answers `/quote` for a symbol it does not know. */
const UNKNOWN_QUOTE = { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 };

/** How `/stock/candle` answers for a range with no trading day. */
const NO_DATA = { s: "no_data" };

/** How the free plan answers `/stock/candle`. */
const FORBIDDEN = 403;

/** The address of a call, however ky hands it to `fetch`. */
const urlOf = (input: string | URL | Request) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** The headers of a call, however ky hands it to `fetch`. */
const headersOf = (input: string | URL | Request, init?: RequestInit) =>
  input instanceof Request ? input.headers : new Headers(init?.headers);

function respond(bySymbol: Record<string, SymbolAnswers>) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input);
    const endpoint = url.pathname.replace("/api/v1/", "") as keyof SymbolAnswers;
    const answer = bySymbol[url.searchParams.get("symbol") ?? ""]?.[endpoint];

    if (answer === undefined) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }

    if (typeof answer === "number") {
      return Promise.resolve(new Response("Refused", { status: answer }));
    }

    return Promise.resolve(Response.json(answer));
  });
}

/** A fixed point to move away from; the cache only reads the clock, nothing in it is on a timer. */
const START = 1_700_000_000_000;

/** A fresh client per case, so no case reads another's cache. */
let client = new FinnhubClient(new Cache(), "test-key");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START);
  client = new FinnhubClient(new Cache(), "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getStocks", () => {
  it("returns each stock in the declared order, named and priced in its own currency", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        AAPL: {
          quote: quote(230, 1.5),
          "stock/profile2": { name: "Apple Inc", currency: "USD" },
          "stock/candle": { s: "ok", c: [220, 225, 230] },
        },
        "AIR.PA": {
          quote: quote(140, -2),
          "stock/profile2": { name: "Airbus SE", currency: "EUR" },
          "stock/candle": { s: "no_data" },
        },
      }),
    );

    const stocks = await client.getStocks(["AIR.PA", "AAPL"]);

    expect(stocks.map(stock => stock.symbol)).toEqual(["AIR.PA", "AAPL"]);
    expect(stocks[0]).toMatchObject({ name: "Airbus SE", currency: "EUR", price: 140, changePercent: -2, closes: [] });
    expect(stocks[1]).toMatchObject({ name: "Apple Inc", currency: "USD", closes: [220, 225, 230] });
  });

  it("sends the key in the header Finnhub reads", async () => {
    const fetcher = respond({ AAPL: { quote: quote(230, 1.5), "stock/profile2": {}, "stock/candle": NO_DATA } });

    vi.stubGlobal("fetch", fetcher);

    await client.getStocks(["AAPL"]);

    const [input, init] = fetcher.mock.calls[0]!;

    expect(headersOf(input, init).get("X-Finnhub-Token")).toBe("test-key");
  });

  it("keeps the quote of a stock whose curve the plan refuses", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ AAPL: { quote: quote(230, 1.5), "stock/profile2": {}, "stock/candle": FORBIDDEN } }),
    );

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const stocks = await client.getStocks(["AAPL"]);

    expect(stocks[0]).toMatchObject({ symbol: "AAPL", price: 230, name: undefined, closes: [] });
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ symbol: "AAPL" }));
  });

  it("keeps the quote of a stock whose profile could not be read", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ AAPL: { quote: quote(230, 1.5), "stock/profile2": 429, "stock/candle": NO_DATA } }),
    );

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const stocks = await client.getStocks(["AAPL"]);

    expect(stocks[0]).toMatchObject({ symbol: "AAPL", price: 230, name: undefined, currency: undefined });
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ symbol: "AAPL" }));
  });

  it("drops a symbol Finnhub does not know instead of showing it at 0", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        AAPL: { quote: quote(230, 1.5), "stock/profile2": {}, "stock/candle": NO_DATA },
        APPL: { quote: UNKNOWN_QUOTE, "stock/profile2": {} },
      }),
    );

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const stocks = await client.getStocks(["AAPL", "APPL"]);

    expect(stocks.map(stock => stock.symbol)).toEqual(["AAPL"]);
    // Dropped from the card, but named in the log, so a typo in `hangar.yml` can be found.
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ symbol: "APPL" }));
  });

  it("fails when no symbol could be quoted, so the card shows its error rather than an empty list", async () => {
    vi.stubGlobal("fetch", respond({ AAPL: { quote: 401 }, MSFT: { quote: 401 } }));
    vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await expect(client.getStocks(["AAPL", "MSFT"])).rejects.toThrow("Finnhub quoted none of the symbols");
  });

  it("fails without a key, naming the variable to set", async () => {
    const fetcher = respond({});

    vi.stubGlobal("fetch", fetcher);

    await expect(new FinnhubClient(new Cache()).getStocks(["AAPL"])).rejects.toThrow("FINNHUB_API_KEY");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks for the profile once a day, and for the quote again once it went stale", async () => {
    const fetcher = respond({
      AAPL: { quote: quote(230, 1.5), "stock/profile2": {}, "stock/candle": { s: "ok", c: [] } },
    });
    const calls = (endpoint: string) =>
      fetcher.mock.calls.filter(([input]) => urlOf(input).pathname === `/api/v1/${endpoint}`).length;

    vi.stubGlobal("fetch", fetcher);

    await client.getStocks(["AAPL"]);
    vi.setSystemTime(START + 2 * 60 * 1_000);
    await client.getStocks(["AAPL"]);

    expect(calls("quote")).toBe(2);
    expect(calls("stock/profile2")).toBe(1);
    expect(calls("stock/candle")).toBe(1);
  });
});
