/** The coordinate space a sparkline is drawn in: its SVG's `viewBox`, stretched to whatever size the row gives it. */
export type SparklineBox = {
  width: number;
  height: number;
};

/** One known price and the day it falls on, by its index in the series. */
type KnownPrice = {
  index: number;
  price: number;
};

/** A price curve with no axes, as the `points` of SVG polylines. */
export class Sparkline {
  /** Two decimals are finer than a screen draws a 100-wide box, and keep the markup short. */
  private static readonly Decimals = 2;

  /**
   * The `points` of each polyline that draws `prices`, oldest first. A null is a gap: the curve breaks there rather
   * than dropping to zero, so each run of known prices is a polyline of its own. A run of one price repeats its point,
   * which a round line cap draws as a dot. Prices span the full width, the lowest at the bottom; a flat series runs
   * through the middle. No known price, no polyline.
   */
  static polylines(prices: readonly (number | null)[], box: SparklineBox): string[] {
    const known = prices.filter(price => price !== null);

    if (known.length === 0) {
      return [];
    }

    const lowest = Math.min(...known);
    const range = Math.max(...known) - lowest;
    const lastIndex = prices.length - 1;

    const x = (index: number) => (lastIndex === 0 ? box.width / 2 : (index / lastIndex) * box.width);
    const y = (price: number) => (range === 0 ? box.height / 2 : box.height - ((price - lowest) / range) * box.height);

    return Sparkline.runs(prices).map(run => {
      const points = run.map(({ index, price }) => Sparkline.point(x(index), y(price)));

      if (points.length === 1) {
        points.push(points[0]!);
      }

      return points.join(" ");
    });
  }

  /** The runs of consecutive known prices. */
  private static runs(prices: readonly (number | null)[]) {
    const runs: KnownPrice[][] = [];
    let current: KnownPrice[] = [];

    prices.forEach((price, index) => {
      if (price === null) {
        current = [];

        return;
      }

      if (current.length === 0) {
        runs.push(current);
      }

      current.push({ index, price });
    });

    return runs;
  }

  /** One point as a `points` attribute writes it. */
  private static point(x: number, y: number) {
    return `${Number(x.toFixed(Sparkline.Decimals))},${Number(y.toFixed(Sparkline.Decimals))}`;
  }
}
