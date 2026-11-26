import type { TcgCollectorCards, TcgDailyPrices, TcgFollowedCard } from "#libs/api";
import { Badge } from "#modules/common/ui/badge.tsx";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetImage } from "#modules/widgets/widget-image.ts";
import { WidgetSparkline } from "../widget-sparkline.tsx";
import { WidgetCard, WidgetContent, WidgetHeader, WidgetList, WidgetListItem, WidgetMetadata } from "../widget.tsx";

/** How the card writes prices and days. */
class CardFormat {
  private static readonly Euros = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

  /** Days are calendar dates, written in UTC so that no time zone moves one to the day before. */
  private static readonly Day = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  /** A price in euros: an unknown one is a dash, never a zero. */
  static price(price: number | null) {
    return price === null ? "—" : CardFormat.Euros.format(price);
  }

  /** A `YYYY-MM-DD` day, as `Oct 11, 2026`. */
  static day(day: string) {
    return CardFormat.Day.format(new Date(`${day}T00:00:00Z`));
  }
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
  label: "Trend" | "Low";
  prices: (number | null)[];
};

/** A card's prices as its curve draws them. */
export class PriceCurve {
  private static readonly MillisecondsPerDay = 86_400_000;

  /** The games tcg-collector collects, by Cardmarket's game id. */
  private static readonly GameNames: ReadonlyMap<number, string> = new Map([
    [1, "Magic"],
    [21, "Star Wars Unlimited"],
  ]);

  /**
   * The trend over the window, or the lowest offer for a card Cardmarket gives no trend: a curve of the cheapest copy
   * beats none. A day outside the window is left out.
   */
  static series(history: readonly TcgDailyPrices[], { days, lastDay }: PriceWindow): PriceSeries {
    const hasTrend = history.some(entry => entry.trend !== null);
    const prices = Array.from<number | null>({ length: days }).fill(null);
    const lastSlot = days - 1;

    for (const entry of history) {
      const slot = lastSlot - (PriceCurve.dayNumber(lastDay) - PriceCurve.dayNumber(entry.day));

      if (slot >= 0 && slot <= lastSlot) {
        prices[slot] = hasTrend ? entry.trend : entry.low;
      }
    }

    return { label: hasTrend ? "Trend" : "Low", prices };
  }

  /** What the curve shows, for a screen reader: `Trend over 30 days: from €1.20 to €1.45`. */
  static describe({ label, prices }: PriceSeries) {
    const known = prices.filter(price => price !== null);
    const period = `${label} over ${Units.count(prices.length, "day", "days")}`;

    if (known.length === 1) {
      return `${period}: ${CardFormat.price(known[0]!)}`;
    }

    return `${period}: from ${CardFormat.price(known[0] ?? null)} to ${CardFormat.price(known.at(-1) ?? null)}`;
  }

  /** The latest day any card has a price for, `YYYY-MM-DD`; `undefined` when none has one. */
  static latestDay(cards: readonly TcgFollowedCard[]) {
    // ISO dates sort as text.
    return cards
      .flatMap(({ history }) => history.at(-1)?.day ?? [])
      .sort()
      .at(-1);
  }

  /** A game's name, or its id for a game the card does not know by name. */
  static gameName(game: number) {
    return PriceCurve.GameNames.get(game) ?? `Game ${game}`;
  }

  /** A `YYYY-MM-DD` day as a count of days, so that two days subtract to the days between them. */
  private static dayNumber(day: string) {
    return Date.parse(`${day}T00:00:00Z`) / PriceCurve.MillisecondsPerDay;
  }
}

/**
 * The sheet of one card on tcg-collector's page, which opens it from its address. A link written with a final slash
 * would otherwise give `//?game=…`, which the page does not serve.
 */
class CardPage {
  static url(link: string, { game, product }: TcgFollowedCard) {
    return `${link.replace(/\/+$/, "")}/?game=${game}&card=${product}`;
  }
}

/** The frame of a card's image, kept with no image, so that every name starts on the same column. */
class Thumbnail {
  static readonly ClassName = "block aspect-5/7 w-10 shrink-0 overflow-hidden rounded-sm bg-muted";
}

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
      <WidgetListItem media={<span className={Thumbnail.ClassName} />}>
        <p className="truncate font-medium text-muted-foreground">Card not found</p>
        <p className="truncate text-xs text-muted-foreground">
          {PriceCurve.gameName(followed.game)} · product {followed.product}
        </p>
      </WidgetListItem>
    );
  }

  const cardUrl = link ? CardPage.url(link, followed) : undefined;
  const series = priceWindow && PriceCurve.series(followed.history, priceWindow);

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
          className={Thumbnail.ClassName}
        >
          <img
            src={WidgetImage.url(placementKey, followed.imageId)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      }
      trailing={series && <WidgetSparkline prices={series.prices} label={PriceCurve.describe(series)} />}
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
        {card.version !== null && <Badge variant="outline">V.{card.version}</Badge>}
      </div>
      {card.expansion && <p className="truncate text-xs text-muted-foreground">{card.expansion}</p>}
      <p className="flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-primary">
          <span className="sr-only">Trend </span>
          {CardFormat.price(card.trend)}
        </span>
        <WidgetMetadata>
          <span>Low {CardFormat.price(card.low)}</span>
          {/* Most cards have no foil printing: a dash there would read as a missing price. */}
          {card.trendFoil !== null && <span>Foil {CardFormat.price(card.trendFoil)}</span>}
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
  const look = WidgetAppearance.get("tcg-collector-cards");
  const latestDay = PriceCurve.latestDay(cards);
  const priceWindow = latestDay === undefined ? undefined : { days, lastDay: latestDay };

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{Units.count(cards.length, "card", "cards")}</span>
            <span>{Units.count(days, "day", "days")}</span>
            {latestDay && <span>as of {CardFormat.day(latestDay)}</span>}
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
