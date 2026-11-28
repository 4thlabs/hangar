import type { FinnhubCloses, FinnhubProfile, FinnhubQuote } from "#libs/api";

/** A stock as its tile shows it, in the currency it is quoted in. */
export type StockView = FinnhubQuote & {
  /** The company's name; `null` when Finnhub has no profile of it. */
  name: string | null;
  /** The ISO 4217 code of its currency; `null` when Finnhub has no profile of it. */
  currency: string | null;
  /** Its daily closes over the last month, oldest first; none when Finnhub's plan gives none. */
  closes: number[];
};

/** The stocks Finnhub quoted, in the order `hangar.yml` lists them, each with its profile and closes when there are. */
export function finnhubView(
  quotes: readonly FinnhubQuote[],
  profiles: readonly FinnhubProfile[],
  closes: readonly FinnhubCloses[],
): StockView[] {
  return quotes.map(quote => {
    const profile = profiles.find(candidate => candidate.symbol === quote.symbol);
    const curve = closes.find(candidate => candidate.symbol === quote.symbol);

    return {
      ...quote,
      name: profile?.name ?? null,
      currency: profile?.currency ?? null,
      closes: curve?.closes ?? [],
    };
  });
}
