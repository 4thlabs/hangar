/** The stocks card's words. */
export class StockMessages {
  static readonly en = {
    title: "Stocks",
    errorDescription: "The stock prices could not be loaded.",
    tickers: ({ count }: { count: number }) => (count === 1 ? "1 ticker" : `${count} tickers`),
    closes: ({ from, to }: { from: string; to: string }) => `Closes over the last month: from ${from} to ${to}`,
    best: "Best",
    worst: "Worst",
    rising: "Rising",
    of: ({ total }: { total: number }) => `of ${total}`,
    /** The day's high, low and open, in a letter each. */
    high: "H",
    low: "L",
    open: "O",
  };

  static readonly fr: typeof StockMessages.en = {
    title: "Bourse",
    errorDescription: "Les cours n’ont pas pu être chargés.",
    tickers: ({ count }) => (count > 1 ? `${count} valeurs` : `${count} valeur`),
    closes: ({ from, to }) => `Clôtures du dernier mois : de ${from} à ${to}`,
    best: "Meilleure",
    worst: "Pire",
    rising: "En hausse",
    of: ({ total }) => `sur ${total}`,
    high: "H",
    low: "B",
    open: "O",
  };
}
