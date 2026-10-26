import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
} from "../shared/index.ts";
import { Sparkline } from "../tcg-collector/sparkline.ts";
import {
  FinnhubClient,
  type ChartResolution,
  type FinnhubChartPoint,
  type FinnhubProfile,
  type FinnhubQuote,
} from "./api/client.ts";
import { stockPricesDescriptor } from "./descriptor.ts";

const { appearance } = stockPricesDescriptor;

/** The sparkline's viewBox, stretched to its frame. */
const SPARKLINE_BOX = { width: 100, height: 24 };

/** Format a price in the widget's currency. */
const PriceFormat = (currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format a percentage. */
const PercentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a volume as a short number. */
const VolumeFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** One ticker's full data, as the widget renders it. */
export type TickerData = {
  ticker: string;
  quote: FinnhubQuote;
  profile: FinnhubProfile | undefined;
  history: FinnhubChartPoint[];
};

/** The sparkline points for one ticker, as a polyline string. */
function sparklinePoints(history: FinnhubChartPoint[]): string[] {
  if (history.length === 0) {
    return [];
  }

  const prices = history.map(point => point.y);

  return Sparkline.polylines(prices, SPARKLINE_BOX);
}

/** A sparkline SVG for one ticker's price history. */
function TickerSparkline({ history }: { history: FinnhubChartPoint[] }) {
  const points = sparklinePoints(history);

  if (points.length === 0) {
    return null;
  }

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_BOX.width} ${SPARKLINE_BOX.height}`}
      preserveAspectRatio="none"
      className="h-6 w-16 shrink-0 overflow-visible text-primary"
    >
      {points.map(point => (
        <polyline
          key={point}
          points={point}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** The period the sparkline covers, in days. */
const SPARKLINE_DAYS = 30;

/** The resolution for a 30-day sparkline. */
const SPARKLINE_RESOLUTION: ChartResolution = "D";

/** The arrow shown for a positive, negative, or flat price change. */
function changeArrow(dp: number): string {
  if (dp > 0) {
    return "▲";
  }

  if (dp < 0) {
    return "▼";
  }

  return "—";
}

/** The color class for a price change. */
function changeColor(quote: FinnhubQuote): string {
  if (quote.dp > 0) {
    return "text-emerald-500";
  }

  if (quote.dp < 0) {
    return "text-red-500";
  }

  return "text-muted-foreground";
}

/** One ticker card in the grid view. */
function TickerCard({ data, currency }: { data: TickerData; currency: string }) {
  const { ticker, quote, profile, history } = data;
  const priceFmt = PriceFormat(currency);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-primary">{ticker}</p>
          {profile && <p className="truncate text-xs text-muted-foreground">{profile.name}</p>}
        </div>
        <TickerSparkline history={history} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-primary">{priceFmt.format(quote.c)}</span>
        <span className={`tabular-nums ${changeColor(quote)}`}>
          {changeArrow(quote.dp)} {Math.abs(quote.dp).toFixed(2)}%
        </span>
      </div>
      <WidgetMetadata>
        <span>H {quote.h.toFixed(2)}</span>
        <span>L {quote.l.toFixed(2)}</span>
        <span>O {quote.o.toFixed(2)}</span>
      </WidgetMetadata>
    </div>
  );
}

/** The widget's card, showing all tickers. */
function StockWidgetCard({
  tickers,
  currency,
  serviceUrl,
}: {
  tickers: TickerData[];
  currency: string;
  serviceUrl: string;
}) {
  const priceFmt = PriceFormat(currency);
  const totalValue = tickers.reduce((sum, t) => sum + t.quote.c, 0);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>
              {tickers.length} {tickers.length === 1 ? "ticker" : "tickers"}
            </span>
            <span>{currency}</span>
            <span>30d</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label="Avg price" value={priceFmt.format(totalValue / tickers.length)} />
          {(() => {
            const { max: best, min: worst } = tickers.reduce(
              (acc, t) => ({ max: Math.max(acc.max, t.quote.dp), min: Math.min(acc.min, t.quote.dp) }),
              { max: -Infinity, min: Infinity },
            );

            return (
              <>
                <WidgetMetric
                  label="Best"
                  value={PercentFormat.format(best / 100)}
                  tone={best > 0 ? "default" : "destructive"}
                />
                <WidgetMetric
                  label="Worst"
                  value={PercentFormat.format(worst / 100)}
                  tone={worst < 0 ? "destructive" : "default"}
                />
              </>
            );
          })()}
          <WidgetMetric label="Tickers" value={tickers.length} />
        </WidgetMetricGrid>

        <div className="grid w-full grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
          {tickers.map(ticker => (
            <TickerCard key={ticker.ticker} data={ticker} currency={currency} />
          ))}
        </div>
      </WidgetContent>
    </WidgetCard>
  );
}

/** Load and render the stock prices. */
export const stockWidget = (
  service: WidgetService,
  { tickers, currency }: { tickers: string[]; currency: string },
): WidgetBody<TickerData[]> => ({
  load: async () => {
    const client = await FinnhubClient.connect(service);

    const now = Math.floor(Date.now() / 1_000);
    const from = now - SPARKLINE_DAYS * 24 * 60 * 60;

    const results = await Promise.allSettled(
      tickers.map(async ticker => ({
        ticker,
        quote: await client.getQuote(ticker),
        profile: await client.getProfile(ticker),
        history: await client.getChart(ticker, SPARKLINE_RESOLUTION, from, now),
      })),
    );

    return results
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<{
          ticker: string;
          quote: FinnhubQuote;
          profile: FinnhubProfile | undefined;
          history: FinnhubChartPoint[];
        }> => r.status === "fulfilled",
      )
      .map(r => r.value);
  },
  render: (tickers, _placementKey) => (
    <StockWidgetCard tickers={tickers} currency={currency} serviceUrl={service.link} />
  ),
});
