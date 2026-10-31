import ky, { type KyInstance } from "ky";
import type { Cache, CachePolicy } from "#libs/cache";
import { cache } from "#libs/cache/server";
import { env } from "#libs/env";
import { logger } from "#libs/logs";

/** One stock as the card shows it. */
export interface Stock {
  /** The symbol, as declared in hangar.yml. */
  symbol: string;
  /** The company's name; absent when Finnhub has no profile for the symbol. */
  name: string | undefined;
  /** The ISO 4217 code the stock is quoted in; absent when Finnhub has no profile for the symbol. */
  currency: string | undefined;
  /** The last price, in {@link currency}. */
  price: number;
  /** The change since the previous close, in percent. */
  changePercent: number;
  high: number;
  low: number;
  open: number;
  /** The daily closes over the last month, oldest first. Empty when the Finnhub plan has no access to them. */
  closes: number[];
}

/**
 * The fields Hangar reads from `GET /quote`. Finnhub answers a symbol it does not know with zeros and null changes
 * rather than an error.
 */
interface FinnhubQuote {
  c: number;
  dp: number | null;
  h: number;
  l: number;
  o: number;
}

/** The fields Hangar reads from `GET /stock/profile2`: one object, empty for a symbol with no profile. */
interface FinnhubProfile {
  name?: string;
  currency?: string;
}

/** The fields Hangar reads from `GET /stock/candle`. `s` is `no_data` when the range has no trading day. */
interface FinnhubCandles {
  s: "ok" | "no_data";
  c?: number[];
}

/**
 * Talks to the Finnhub REST API for the stocks card. Each call is cached per symbol, so every placement of the card
 * shares them and the free plan's 60 calls a minute go a long way.
 *
 * ponytail: per-process cache; move the refresh into a sidequest job if Hangar ever runs more than one instance.
 */
export class FinnhubClient {
  /** A quote moves every second the market is open; this only spares two placements asking twice. */
  private static readonly QuotePolicy: CachePolicy = { ttl: 30 * 1_000 };

  /** A company's name and currency hardly ever change; served for a day, and for a week while Finnhub fails. */
  private static readonly ProfilePolicy: CachePolicy = {
    ttl: 24 * 60 * 60 * 1_000,
    maxStale: 7 * 24 * 60 * 60 * 1_000,
  };

  /** Daily closes gain one point a day; an hour keeps the curve current without spending a call per visit. */
  private static readonly ClosesPolicy: CachePolicy = { ttl: 60 * 60 * 1_000, maxStale: 24 * 60 * 60 * 1_000 };

  /** The period the curve covers. */
  private static readonly ClosesDays = 30;

  /** One entry per symbol and endpoint. The widget layer caches what the card loads; this caches each call. */
  private readonly cache: Cache;

  /** The ky client, bound to the API and the key; `undefined` without a key, which Finnhub always requires. */
  private readonly http: KyInstance | undefined;

  /**
   * @param cache Where the calls are kept, under `finnhub:` keys
   * @param token A Finnhub API key, free at finnhub.io
   */
  constructor(cache: Cache, token?: string) {
    this.cache = cache;
    this.http = token === undefined ? undefined : FinnhubClient.connect(token);
  }

  /** The ky client, bound to the API and the key. */
  private static connect(token: string): KyInstance {
    return ky.extend({
      baseUrl: "https://finnhub.io",
      prefix: "/api/v1",
      retry: { limit: 1 },
      timeout: 10_000,
      headers: { "X-Finnhub-Token": token },
    });
  }

  /**
   * Each symbol's stock, in the order given. A symbol Finnhub cannot quote is skipped and logged, so one bad entry
   * cannot take the card down; when none can be quoted, this throws, and the card shows its error.
   */
  async getStocks(symbols: readonly string[]): Promise<Stock[]> {
    const { http } = this;

    if (http === undefined) {
      throw new Error("FINNHUB_API_KEY is not set: the stocks card needs a Finnhub API key");
    }

    const settled = await Promise.allSettled(symbols.map(symbol => this.getStock(http, symbol)));
    const stocks: Stock[] = [];
    const failures: unknown[] = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        stocks.push(result.value);
      } else {
        failures.push(result.reason);
        logger.warn("Skipping a symbol on the stocks card", { error: result.reason, symbol: symbols[index] });
      }
    }

    if (stocks.length === 0) {
      throw new AggregateError(failures, "Finnhub quoted none of the symbols");
    }

    return stocks;
  }

  /**
   * One symbol's stock. Its three calls are independent, so they run side by side. Only the quote is needed: without
   * its profile the stock shows with no name and a bare price, and is asked for it again on the next load.
   */
  private async getStock(http: KyInstance, symbol: string): Promise<Stock> {
    const [quote, profile, closes] = await Promise.all([
      this.getQuote(http, symbol),
      this.getProfile(http, symbol).catch((error: unknown): FinnhubProfile => {
        logger.warn("Showing a stock without its profile", { error, symbol });

        return {};
      }),
      this.getCloses(http, symbol),
    ]);

    return {
      symbol,
      name: profile.name,
      currency: profile.currency,
      price: quote.c,
      changePercent: quote.dp,
      high: quote.h,
      low: quote.l,
      open: quote.o,
      closes,
    };
  }

  /** The symbol's quote, through the cache. Throws for a symbol Finnhub does not know, rather than show it at 0. */
  private getQuote(http: KyInstance, symbol: string): Promise<FinnhubQuote & { dp: number }> {
    return this.cache.get(`finnhub:quote:${symbol}`, FinnhubClient.QuotePolicy, async () => {
      const quote = await http.get<FinnhubQuote>("quote", { searchParams: { symbol } }).json();
      const { dp } = quote;

      if (dp === null) {
        throw new Error(`Finnhub knows no symbol ${symbol}`);
      }

      return { ...quote, dp };
    });
  }

  /** The symbol's profile, through the cache. */
  private getProfile(http: KyInstance, symbol: string): Promise<FinnhubProfile> {
    return this.cache.get(`finnhub:profile:${symbol}`, FinnhubClient.ProfilePolicy, () =>
      http.get<FinnhubProfile>("stock/profile2", { searchParams: { symbol } }).json(),
    );
  }

  /**
   * The symbol's daily closes, through the cache. The free plan refuses them: the card then shows no curve, but still
   * the quote, and the refusal is logged and kept for as long as a curve would be.
   */
  private getCloses(http: KyInstance, symbol: string): Promise<number[]> {
    return this.cache.get(`finnhub:closes:${symbol}`, FinnhubClient.ClosesPolicy, async () => {
      const to = Math.floor(Date.now() / 1_000);
      const from = to - FinnhubClient.ClosesDays * 24 * 60 * 60;

      const searchParams = { symbol, resolution: "D", from, to };

      try {
        const candles = await http.get<FinnhubCandles>("stock/candle", { searchParams }).json();

        return candles.s === "ok" ? (candles.c ?? []) : [];
      } catch (error: unknown) {
        logger.warn("Showing a stock without its curve", { error, symbol });

        return [];
      }
    });
  }
}

/** The client the dashboard shares, so every placement of the card reads one cache. */
export const finnhubClient = new FinnhubClient(cache, env.FINNHUB_API_KEY);
