import type { TcgCollectorCards, TcgDailyPrices, TcgFollowedCard } from "#libs/api";
import { Badge } from "#modules/common/ui/badge.tsx";
import { WidgetSparkline } from "#modules/widgets/components/widget-sparkline.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { widgetImageUrl } from "#modules/widgets/helpers/widget-image.ts";
import { widgetsLabels } from "#modules/widgets/helpers/widgets-labels.ts";
import { m } from "#paraglide/messages.js";

// How the card writes prices and days.

const eurosFormat = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

/** Days are calendar dates, written in UTC so that no time zone moves one to the day before. */
const dayFormat = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** A price in euros: an unknown one is a dash, never a zero. */
function formatEuros(price: number | null) {
  return price === null ? "—" : eurosFormat.format(price);
}

/** A `YYYY-MM-DD` day, as `Oct 11, 2026`. */
function formatDay(day: string) {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/**
 * The days every curve of the card spans: the period of the widget, ending on the latest day any card has a price
 * for. Shared, so that the rows read on one time axis: a card added three days ago fills the last three days.
 */
export type PriceWindow = {
  days: number;
  /** `YYYY-MM-DD`. */
  lastDay: string;
};

/** Which price a curve follows, and that price on each day of the window, oldest first; null where it has none. */
export type PriceSeries = {
  /** The trend's label, or the lowest offer's. */
  label: string;
  prices: (number | null)[];
};

// A card's prices as its curve draws them.

const millisecondsPerDay = 86_400_000;

/**
 * The trend over the window, or the lowest offer for a card Cardmarket gives no trend: a curve of the cheapest copy
 * beats none. A day outside the window is left out.
 */
export function priceSeries(history: readonly TcgDailyPrices[], { days, lastDay }: PriceWindow): PriceSeries {
  const hasTrend = history.some(entry => entry.trend !== null);
  const prices = Array.from<number | null>({ length: days }).fill(null);
  const lastSlot = days - 1;

  for (const entry of history) {
    const slot = lastSlot - (dayNumber(lastDay) - dayNumber(entry.day));

    if (slot >= 0 && slot <= lastSlot) {
      prices[slot] = hasTrend ? entry.trend : entry.low;
    }
  }

  return { label: hasTrend ? m.widgets_tcg_trend() : m.widgets_tcg_low(), prices };
}

/** What the curve shows, for a screen reader: `Trend over 30 days: from €1.20 to €1.45`. */
export function describePriceSeries({ label, prices }: PriceSeries) {
  const known = prices.filter(price => price !== null);
  const period = m.widgets_tcg_series({ label, days: prices.length });

  if (known.length === 1) {
    return m.widgets_tcg_series_at({ period, price: formatEuros(known[0]!) });
  }

  return m.widgets_tcg_series_from_to({
    period,
    from: formatEuros(known[0] ?? null),
    to: formatEuros(known.at(-1) ?? null),
  });
}

/** The latest day any card has a price for, `YYYY-MM-DD`; `undefined` when none has one. */
export function latestPriceDay(cards: readonly TcgFollowedCard[]) {
  // ISO dates sort as text.
  return cards
    .flatMap(({ history }) => history.at(-1)?.day ?? [])
    .sort()
    .at(-1);
}

/** A game's name, or its id for a game the card does not know by name. */
export function gameName(game: number) {
  return widgetsLabels.games.get(game)?.() ?? m.widgets_tcg_game({ game });
}

/** A `YYYY-MM-DD` day as a count of days, so that two days subtract to the days between them. */
function dayNumber(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / millisecondsPerDay;
}

/**
 * The sheet of one card on tcg-collector's page, which opens it from its address. A link written with a final slash
 * would otherwise give `//?game=…`, which the page does not serve.
 */
function cardPageUrl(link: string, { game, product }: TcgFollowedCard) {
  return `${link.replace(/\/+$/, "")}/?game=${game}&card=${product}`;
}

/** The frame of a card's image, kept with no image, so that every name starts on the same column. */
const thumbnailClassName = "block aspect-5/7 w-10 shrink-0 overflow-hidden rounded-sm bg-muted";

type CardRowProps = {
  followed: TcgFollowedCard;
  /** The curves' common window; none while no card has a price. */
  priceWindow: PriceWindow | undefined;
  link: string | null;
  placementKey: string;
};

/** One card's row: what it is, what it is worth, and how that moved. */
function CardRow({ followed, priceWindow, link, placementKey }: CardRowProps) {
  const { card } = followed;

  if (!card) {
    return (
      <WidgetListItem media={<span className={thumbnailClassName} />}>
        <p className="truncate font-medium text-muted-foreground">{m.widgets_tcg_not_found()}</p>
        <p className="truncate text-xs text-muted-foreground">
          {gameName(followed.game)} · {m.widgets_tcg_product({ product: followed.product })}
        </p>
      </WidgetListItem>
    );
  }

  const cardUrl = link ? cardPageUrl(link, followed) : undefined;
  const series = priceWindow && priceSeries(followed.history, priceWindow);

  return (
    <WidgetListItem
      media={
        // Decorative: the name beside it is the same link. A card with no image is a 404, which an empty alt hides.
        <a
          {...(cardUrl ? { href: cardUrl } : {})}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          aria-hidden="true"
          className={thumbnailClassName}
        >
          <img
            src={widgetImageUrl(placementKey, followed.imageId)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      }
      trailing={series && <WidgetSparkline prices={series.prices} label={describePriceSeries(series)} />}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <a
          {...(cardUrl ? { href: cardUrl } : {})}
          target="_blank"
          rel="noreferrer"
          className="truncate font-medium text-primary hover:underline"
        >
          {card.name}
        </a>
        {card.version !== null && <Badge variant="outline">{m.widgets_tcg_version({ version: card.version })}</Badge>}
      </div>
      {card.expansion && <p className="truncate text-xs text-muted-foreground">{card.expansion}</p>}
      <p className="flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-primary">
          <span className="sr-only">{m.widgets_tcg_trend()} </span>
          {formatEuros(card.trend)}
        </span>
        <WidgetMetadata>
          <span>{m.widgets_tcg_low_price({ price: formatEuros(card.low) })}</span>
          {/* Most cards have no foil printing: a dash there would read as a missing price. */}
          {card.trendFoil !== null && <span>{m.widgets_tcg_foil_price({ price: formatEuros(card.trendFoil) })}</span>}
        </WidgetMetadata>
      </p>
    </WidgetListItem>
  );
}

type TcgCollectorCardProps = {
  cards: TcgCollectorCards;
  /** The placement's key, which its images are relayed by. */
  placementKey: string;
  link: string | null;
};

/** The cards tcg-collector follows: their prices, and the curve of each over the widget's days. */
export function TcgCollectorCard({ cards: { days, cards }, placementKey, link }: TcgCollectorCardProps) {
  const look = widgetLook("tcg-collector-cards");
  const latestDay = latestPriceDay(cards);
  const priceWindow = latestDay === undefined ? undefined : { days, lastDay: latestDay };

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_counts_cards({ count: cards.length })}</span>
            <span>{m.widgets_counts_days({ count: days })}</span>
            {latestDay && <span>{m.widgets_tcg_as_of({ day: formatDay(latestDay) })}</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList>
          {cards.map((followed, index) => (
            // A card may be listed twice: its place in the list tells the two rows apart.
            <CardRow
              key={`${index}-${followed.imageId}`}
              followed={followed}
              priceWindow={priceWindow}
              link={link}
              placementKey={placementKey}
            />
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
