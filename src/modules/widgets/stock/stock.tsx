import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
} from "../shared/index.ts";
import { Sparkline } from "../tcg-collector/sparkline.ts";
import { type ChartResolution, type FinnhubChartPoint, type FinnhubProfile, type FinnhubQuote, FinnhubClient } from "./api/index.ts";
import { stockPricesDescriptor } from "./descriptor.ts";

const { appearance } = stockPricesDescriptor;

/** The sparkline's viewBox, stretched to its frame. */
const SPARKLINE_BOX = { width: 100, height: 24 };

/** Milliseconds per minute. */
const MS_PER_MIN = 60_000;

/** Format a price in the widget's currency. */
const PriceFormat = (currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format a percentage. */
const PercentFormat = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

/** One ticker row in the list view. */
function TickerRow({ data }: { data: TickerData }) {
  const { ticker, quote, profile, history } = data;

  return (
    <WidgetListItem
      trailing={
        <>
          <TickerSparkline history={history} />
          <span className={`shrink-0 tabular-nums ${changeColor(quote)}`}>
            {quote.dp > 0 ? "+" : ""}
            {PercentFormat.format(quote.dp / 100)}
          </span>
        </>
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-primary">{ticker}</span>
          {profile && <span className="truncate text-xs text-muted-foreground">{profile.name}</span>}
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          H {quote.h.toFixed(2)} · L {quote.l.toFixed(2)} · V {VolumeFormat.format(quote.o)}
        </p>
      </div>
    </WidgetListItem>
  );
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
          {quote.dp > 0 ? "▲" : quote.dp < 0 ? "▼" : "—"}{" "}
          {Math.abs(quote.dp).toFixed(2)}%
        </span>
      </div>
      <WidgetMetadata>
        <span>H {quote.h.toFixed(2)}</span>
        <span>L {quote.l.toFixed(2)}</span>
        <span>V {VolumeFormat.format(quote.o)}</span>
      </WidgetMetadata>
    </div>
  );
}

/** The currency the widget displays prices in, from the declaration. */
const CurrencyFormat = (currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The period the sparkline covers, in days. */
const SPARKLINE_DAYS = 30;

/** The resolution for a 30-day sparkline. */
const SPARKLINE_RESOLUTION: ChartResolution = "D";

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
  const priceFmt = CurrencyFormat(currency);
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
          <WidgetMetric
            label="Best"
            value={PercentFormat.format(Math.max(...tickers.map(t => t.quote.dp)) / 100)}
            tone={Math.max(...tickers.map(t => t.quote.dp)) > 0 ? "default" : "destructive"}
          />
          <WidgetMetric
            label="Worst"
            value={PercentFormat.format(Math.min(...tickers.map(t => t.quote.dp)) / 100)}
            tone={Math.min(...tickers.map(t => t.quote.dp)) < 0 ? "destructive" : "default"}
          />
          <WidgetMetric label="Tickers" value={tickers.length} />
        </WidgetMetricGrid>

        <WidgetList>
          {tickers.map(ticker => (
            <TickerRow key={ticker.ticker} data={ticker} />
          ))}
        </WidgetList>
      </WidgetContent>

      <WidgetFooter>
        <div className="grid w-full grid-cols-2 gap-3 @2xl:grid-cols-4">
          {tickers.map(ticker => (
            <TickerCard key={ticker.ticker} data={ticker} currency={currency} />
          ))}
        </div>
      </WidgetFooter>
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

    const now = Math.floor(Date.now() / MS_PER_MIN);
    const from = now - SPARKLINE_DAYS * 24 * 60;

    const results = await Promise.all(
      tickers.map(async ticker => {
        const [quote, profile, history] = await Promise.all([
          client.getQuote(ticker),
          client.getProfile(ticker),
          client.getChart(ticker, SPARKLINE_RESOLUTION, from, now),
        ]);

        return { ticker, quote, profile, history };
      }),
    );

    return results;
  },
  render: (tickers) => (
    <StockWidgetCard
      tickers={tickers}
      currency={currency}
      serviceUrl={service.link}
    />
  ),
});
