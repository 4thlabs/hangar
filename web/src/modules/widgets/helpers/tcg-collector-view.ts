import type { TcgDailyPrices, TcgFollowedCard, TcgPrices } from "#libs/api";

/** A followed card as its row shows it: the catalog's entry, and its prices over the widget's days. */
export type TcgCardView = TcgFollowedCard & {
  /** Its prices, oldest first, from the first day that has one; none when tcg-collector has none. */
  history: TcgDailyPrices[];
};

/** What the card shows of tcg-collector: the period of its curves, and each card with its curve. */
export type TcgCollectorView = {
  days: number;
  cards: TcgCardView[];
};

/** Each of `cards`, in the order `hangar.yml` lists them, with its prices from `prices`. */
export function tcgCollectorView(cards: readonly TcgFollowedCard[], prices: TcgPrices): TcgCollectorView {
  return {
    days: prices.days,
    cards: cards.map(card => ({
      ...card,
      history: prices.cards.find(curve => curve.game === card.game && curve.product === card.product)?.history ?? [],
    })),
  };
}
