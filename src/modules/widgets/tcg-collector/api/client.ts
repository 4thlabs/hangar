import { isHTTPError } from "ky";
import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/** One product of a game's catalog, as tcg-collector indexes it. Prices are in euros, from the latest price guide. */
export interface TcgCard {
  /** Cardmarket's idProduct. */
  product: string;
  name: string;
  single: boolean;
  expansionId: number | null;
  expansion: string | null;
  /** 1, 2… when the expansion has several products with this name (Cardmarket's V.1, V.2…), else null. */
  version: number | null;
  /** When the product entered the catalog, as `YYYY-MM-DD`. */
  added: string | null;
  trend: number | null;
  low: number | null;
  trendFoil: number | null;
}

/** One day of a product's prices, in euros. A day without a new price guide repeats the day before. */
export interface TcgDailyPrices {
  /** `YYYY-MM-DD`. */
  day: string;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg30: number | null;
  low_foil: number | null;
  trend_foil: number | null;
  avg1_foil: number | null;
  avg30_foil: number | null;
}

/** HTTP status tcg-collector answers for a card it has no image of. */
const NO_IMAGE = 404;

/** Talks to one tcg-collector web server. Its API sits under `/api` and takes no key. */
export class TcgCollectorClient extends ServiceClient {
  /** A row's thumbnail is 40 px wide: `small`, 146 px, stays sharp up to a 3× screen. */
  private static readonly ImageSize = "small";

  static async connect(service: WidgetService) {
    return new TcgCollectorClient(await ServiceClient.client(service));
  }

  /** The product's catalog entry, or null when tcg-collector does not know it. */
  async getCard(game: number, product: number) {
    const { card } = await this.http.get<{ card: TcgCard | null }>("card", { searchParams: { game, product } }).json();

    return card;
  }

  /** One entry per day over the last `days`, oldest first, from the first day that has a price. */
  async getDaily(game: number, product: number, days: number) {
    const daily = await this.http
      .get<{ days: TcgDailyPrices[] }>("daily", { searchParams: { game, product, days } })
      .json();

    return daily.days;
  }

  /**
   * A card's image as raw bytes, for `WidgetImages` to relay. `undefined` for a card with no image, which is common
   * and no failure: the relay answers 404 rather than logging an error on every visit.
   */
  async getImage(game: number, product: number) {
    try {
      return await this.http.get("image", {
        searchParams: { game, product, size: TcgCollectorClient.ImageSize },
      });
    } catch (error: unknown) {
      if (isHTTPError(error) && error.response.status === NO_IMAGE) {
        return undefined;
      }

      throw error;
    }
  }
}
