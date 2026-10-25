import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/** One quote as Finnhub returns it. */
export interface FinnhubQuote {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

/** One chart point as Finnhub returns it. */
export interface FinnhubChartPoint {
  x: number;
  y: number;
}

/** A company profile as Finnhub returns it. */
export interface FinnhubProfile {
  name: string;
  ticker: string;
  logo?: string;
}

/** Resolution for the chart endpoint. */
export type ChartResolution = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";

/** Talks to one Finnhub instance. API is at `/api/v1/…` and takes `X-API-Key`. */
export class FinnhubClient extends ServiceClient {
  static async connect(service: WidgetService): Promise<FinnhubClient> {
    return new FinnhubClient(
      await ServiceClient.client(service, {
        apiKeyHeader: "X-API-Key",
        prefix: "/api/v1",
      }),
    );
  }

  async getQuote(ticker: string): Promise<FinnhubQuote> {
    const response = await this.http.get("/quote", { searchParams: { symbol: ticker } }).json();

    return response as FinnhubQuote;
  }

  async getChart(
    ticker: string,
    resolution: ChartResolution = "D",
    from: number,
    to: number,
  ): Promise<FinnhubChartPoint[]> {
    const response = await this.http
      .get("/stock/candle", {
        searchParams: { symbol: ticker, resolution, from: String(from), to: String(to) },
      })
      .json();

    const { c: prices, t: timestamps } = response as { c: number[]; t: number[] };

    return prices
      .map((price, index) => ({ x: timestamps[index], y: price }))
      .filter((point): point is { x: number; y: number } => point.x !== undefined);
  }

  async getProfile(ticker: string): Promise<FinnhubProfile | undefined> {
    const profiles = await this.http.get("/stock/profile2", { searchParams: { symbol: ticker } }).json();

    return (profiles as FinnhubProfile[])[0];
  }
}
