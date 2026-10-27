import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
  WidgetSparkline,
} from "../shared/index.ts";
import { finnhubClient, type Stock } from "./api/client.ts";
import { stockPricesDescriptor } from "./descriptor.ts";

const { appearance } = stockPricesDescriptor;

/** How the card writes prices and their changes. */
export class StockFormat {
  /** Two decimals, as quotes are written. */
  private static readonly Decimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  /** A bare number, for a stock whose currency Finnhub does not say, and for the day's high, low and open. */
  private static readonly Amount = new Intl.NumberFormat("en-US", StockFormat.Decimals);

  /** The sign spelled out, so a fall reads at a glance. */
  private static readonly Change = new Intl.NumberFormat("en-US", {
    style: "percent",
    signDisplay: "exceptZero",
    ...StockFormat.Decimals,
  });

  /** A price in the currency the stock is quoted in: Finnhub converts nothing, so neither does the card. */
  static price(price: number, currency: string | undefined) {
    if (currency === undefined) {
      return StockFormat.Amount.format(price);
    }

    return new Intl.NumberFormat("en-US", { style: "currency", currency, ...StockFormat.Decimals }).format(price);
  }

  /** A price with no currency sign. */
  static amount(amount: number) {
    return StockFormat.Amount.format(amount);
  }

  /** A change in percent, as Finnhub gives it: `1.5` is `+1.50%`. */
  static change(changePercent: number) {
    return StockFormat.Change.format(changePercent / 100);
  }

  /** The color of a change: green up, red down, muted when flat. */
  static changeClassName(changePercent: number) {
    if (changePercent > 0) {
      return "text-emerald-500";
    }

    if (changePercent < 0) {
      return "text-red-500";
    }

    return "text-muted-foreground";
  }
}

/** The stock's closes over the last month. Nothing when the Finnhub plan gives none. */
function ClosesSparkline({ stock }: { stock: Stock }) {
  const first = stock.closes[0];
  const last = stock.closes.at(-1);

  if (first === undefined || last === undefined) {
    return null;
  }

  const from = StockFormat.price(first, stock.currency);
  const to = StockFormat.price(last, stock.currency);

  return <WidgetSparkline prices={stock.closes} label={`Closes over the last month: from ${from} to ${to}`} />;
}

/** One stock: what it is, what it is worth, and how that moved today. */
function StockTile({ stock }: { stock: Stock }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-primary">{stock.symbol}</p>
          {stock.name && <p className="truncate text-xs text-muted-foreground">{stock.name}</p>}
        </div>
        <ClosesSparkline stock={stock} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-primary">
          {StockFormat.price(stock.price, stock.currency)}
        </span>
        <span className={`tabular-nums ${StockFormat.changeClassName(stock.changePercent)}`}>
          {StockFormat.change(stock.changePercent)}
        </span>
      </div>
      <WidgetMetadata>
        <span>H {StockFormat.amount(stock.high)}</span>
        <span>L {StockFormat.amount(stock.low)}</span>
        <span>O {StockFormat.amount(stock.open)}</span>
      </WidgetMetadata>
    </div>
  );
}

/**
 * The day's best and worst change, and how many stocks rose. Only changes are compared: the stocks may be quoted in
 * different currencies, so their prices add up to nothing.
 */
function StockMetrics({ stocks }: { stocks: Stock[] }) {
  const byChange = stocks.toSorted((a, b) => b.changePercent - a.changePercent);
  const best = byChange[0];
  const worst = byChange.at(-1);

  if (best === undefined || worst === undefined) {
    return null;
  }

  const rising = stocks.filter(stock => stock.changePercent > 0).length;

  return (
    <WidgetMetricGrid>
      <WidgetMetric
        label="Best"
        value={StockFormat.change(best.changePercent)}
        detail={best.symbol}
        tone={best.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label="Worst"
        value={StockFormat.change(worst.changePercent)}
        detail={worst.symbol}
        tone={worst.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric label="Rising" value={rising} detail={`of ${stocks.length}`} />
    </WidgetMetricGrid>
  );
}

export function StocksCard({ stocks }: { stocks: Stock[] }) {
  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>
              {stocks.length} {stocks.length === 1 ? "ticker" : "tickers"}
            </span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <StockMetrics stocks={stocks} />

        <div className="grid w-full grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
          {stocks.map(stock => (
            <StockTile key={stock.symbol} stock={stock} />
          ))}
        </div>
      </WidgetContent>
    </WidgetCard>
  );
}

/** The quote of each followed stock, in the order `hangar.yml` lists them. */
export const stockPrices = (tickers: readonly string[]): WidgetBody<Stock[]> => ({
  load: () => finnhubClient.getStocks(tickers),
  render: stocks => <StocksCard stocks={stocks} />,
});
