import { Translation } from "#libs/i18n";
import { Locale, type LocaleCode } from "#libs/preferences";
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
import { StockMessages } from "./messages.ts";

const { appearance } = stockPricesDescriptor;

/** How the card writes prices and their changes, in the reader's language. */
export class StockFormat {
  /** Two decimals, as quotes are written. */
  private static readonly Decimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  /** A price in the currency the stock is quoted in: Finnhub converts nothing, so neither does the card. */
  static price(price: number, currency: string | undefined, locale: LocaleCode) {
    if (currency === undefined) {
      return StockFormat.amount(price, locale);
    }

    return new Intl.NumberFormat(Locale.intlTag(locale), {
      style: "currency",
      currency,
      ...StockFormat.Decimals,
    }).format(price);
  }

  /** A bare number, for a stock whose currency Finnhub does not say, and for the day's high, low and open. */
  static amount(amount: number, locale: LocaleCode) {
    return new Intl.NumberFormat(Locale.intlTag(locale), StockFormat.Decimals).format(amount);
  }

  /** A change in percent, as Finnhub gives it: `1.5` is `+1.50%`. The sign spelled out, so a fall reads at a glance. */
  static change(changePercent: number, locale: LocaleCode) {
    return new Intl.NumberFormat(Locale.intlTag(locale), {
      style: "percent",
      signDisplay: "exceptZero",
      ...StockFormat.Decimals,
    }).format(changePercent / 100);
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
type StockProps = { stock: Stock; locale: LocaleCode };

function ClosesSparkline({ stock, locale }: StockProps) {
  const first = stock.closes[0];
  const last = stock.closes.at(-1);

  if (first === undefined || last === undefined) {
    return null;
  }

  const from = StockFormat.price(first, stock.currency, locale);
  const to = StockFormat.price(last, stock.currency, locale);
  const t = Translation.create(StockMessages, locale);

  return <WidgetSparkline prices={stock.closes} label={t("closes", { from, to })} />;
}

/** One stock: what it is, what it is worth, and how that moved today. */
function StockTile({ stock, locale }: StockProps) {
  const t = Translation.create(StockMessages, locale);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-primary">{stock.symbol}</p>
          {stock.name && <p className="truncate text-xs text-muted-foreground">{stock.name}</p>}
        </div>
        <ClosesSparkline stock={stock} locale={locale} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-primary">
          {StockFormat.price(stock.price, stock.currency, locale)}
        </span>
        <span className={`tabular-nums ${StockFormat.changeClassName(stock.changePercent)}`}>
          {StockFormat.change(stock.changePercent, locale)}
        </span>
      </div>
      <WidgetMetadata>
        <span>
          {t("high")} {StockFormat.amount(stock.high, locale)}
        </span>
        <span>
          {t("low")} {StockFormat.amount(stock.low, locale)}
        </span>
        <span>
          {t("open")} {StockFormat.amount(stock.open, locale)}
        </span>
      </WidgetMetadata>
    </div>
  );
}

/**
 * The day's best and worst change, and how many stocks rose. Only changes are compared: the stocks may be quoted in
 * different currencies, so their prices add up to nothing.
 */
function StockMetrics({ stocks, locale }: { stocks: Stock[]; locale: LocaleCode }) {
  const t = Translation.create(StockMessages, locale);
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
        label={t("best")}
        value={StockFormat.change(best.changePercent, locale)}
        locale={locale}
        detail={best.symbol}
        tone={best.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label={t("worst")}
        value={StockFormat.change(worst.changePercent, locale)}
        locale={locale}
        detail={worst.symbol}
        tone={worst.changePercent < 0 ? "destructive" : "default"}
      />
      <WidgetMetric label={t("rising")} value={rising} detail={t("of", { total: stocks.length })} locale={locale} />
    </WidgetMetricGrid>
  );
}

export function StocksCard({ stocks, locale }: { stocks: Stock[]; locale: LocaleCode }) {
  const t = Translation.create(StockMessages, locale);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        icon={appearance.icon}
        title={t("title")}
        description={
          <WidgetMetadata>
            <span>{t("tickers", { count: stocks.length })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <StockMetrics stocks={stocks} locale={locale} />

        <div className="grid w-full grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
          {stocks.map(stock => (
            <StockTile key={stock.symbol} stock={stock} locale={locale} />
          ))}
        </div>
      </WidgetContent>
    </WidgetCard>
  );
}

/** The quote of each followed stock, in the order `hangar.yml` lists them. */
export const stockPrices = (tickers: readonly string[]): WidgetBody<Stock[]> => ({
  load: () => finnhubClient.getStocks(tickers),
  render: (stocks, _placementKey, locale) => <StocksCard stocks={stocks} locale={locale} />,
});
