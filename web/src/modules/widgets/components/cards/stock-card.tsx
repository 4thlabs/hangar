import type { Stock, StockPrices } from "#libs/api";
import { WidgetSparkline } from "#modules/widgets/components/widget-sparkline.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

// How the card writes prices and their changes.

/** Two decimals, as quotes are written. */
const twoDecimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

const amountFormat = new Intl.NumberFormat("en", twoDecimals);

const changeFormat = new Intl.NumberFormat("en", {
  style: "percent",
  signDisplay: "exceptZero",
  ...twoDecimals,
});

/** A price in the currency the stock is quoted in: Finnhub converts nothing, so neither does the card. */
export function formatPrice(price: number, currency: string | null) {
  if (currency === null || !isCurrencyCode(currency)) {
    return formatAmount(price);
  }

  return new Intl.NumberFormat("en", { style: "currency", currency, ...twoDecimals }).format(price);
}

/** Whether `currency` is a code `Intl` formats, which throws for any other. */
function isCurrencyCode(currency: string) {
  return /^[A-Za-z]{3}$/.test(currency);
}

/** A bare number, for a stock whose currency Finnhub does not say, and for the day's high, low and open. */
export function formatAmount(amount: number) {
  return amountFormat.format(amount);
}

/** A change in percent, as Finnhub gives it: `1.5` is `+1.50%`, its sign written so that a fall reads at a glance. */
export function formatChange(changePercent: number) {
  return changeFormat.format(changePercent / 100);
}

/** The color of a change: green up, red down, muted when flat. */
export function changeClassName(changePercent: number) {
  if (changePercent > 0) {
    return "text-emerald-500";
  }

  if (changePercent < 0) {
    return "text-red-500";
  }

  return "text-muted-foreground";
}

/** The stock's closes over the last month. Nothing when Finnhub's plan gives none. */
function ClosesSparkline({ stock }: { stock: Stock }) {
  const first = stock.closes[0];
  const last = stock.closes.at(-1);

  if (first === undefined || last === undefined) {
    return null;
  }

  const from = formatPrice(first, stock.currency);
  const to = formatPrice(last, stock.currency);

  return <WidgetSparkline prices={stock.closes} label={m.widgets_stocks_closes({ from, to })} />;
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
          {formatPrice(stock.price, stock.currency)}
        </span>
        <span className={`tabular-nums ${changeClassName(stock.changePercent)}`}>
          {formatChange(stock.changePercent)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        <WidgetMetadata>
          <span>{m.widgets_stocks_high({ amount: formatAmount(stock.high) })}</span>
          <span>{m.widgets_stocks_low({ amount: formatAmount(stock.low) })}</span>
          <span>{m.widgets_stocks_open({ amount: formatAmount(stock.open) })}</span>
        </WidgetMetadata>
      </p>
    </div>
  );
}

/**
 * The day's best and worst change, and how many stocks rose. Only the changes compare: the stocks may be quoted in
 * different currencies, whose prices add up to nothing.
 */
function StockMetrics({ stocks }: { stocks: Stock[] }) {
  const byChange = stocks.toSorted((first, second) => second.changePercent - first.changePercent);
  const best = byChange[0];
  const worst = byChange.at(-1);

  if (best === undefined || worst === undefined) {
    return null;
  }

  const rising = stocks.filter(stock => stock.changePercent > 0).length;

  return (
    <WidgetMetricGrid>
      <WidgetMetric
        label={m.widgets_stocks_best()}
        value={formatChange(best.changePercent)}
        detail={best.symbol}
        tone={best.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label={m.widgets_stocks_worst()}
        value={formatChange(worst.changePercent)}
        detail={worst.symbol}
        tone={worst.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label={m.widgets_stocks_rising()}
        value={rising}
        detail={m.widgets_stocks_rising_of({ count: stocks.length })}
      />
    </WidgetMetricGrid>
  );
}

/** The quote of each stock, in the order `hangar.yml` lists them. */
export function StockCard({ prices: { stocks } }: { prices: StockPrices }) {
  const look = widgetLook("stock-prices");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_counts_tickers({ count: stocks.length })}</span>
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
