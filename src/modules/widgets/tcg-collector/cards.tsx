import { Badge } from "#modules/common/ui/badge.tsx";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetImage,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
} from "../shared/index.ts";
import { CardImageId, TcgCollectorClient, type CardImageRef, type TcgCard, type TcgDailyPrices } from "./api/index.ts";
import { tcgCollectorCardsDescriptor } from "./descriptor.ts";
import { Sparkline } from "./sparkline.ts";

const { appearance } = tcgCollectorCardsDescriptor;

/** The games tcg-collector collects, by Cardmarket game id. */
const GAME_NAMES: ReadonlyMap<number, string> = new Map([
  [1, "Magic"],
  [21, "Star Wars Unlimited"],
]);

/** The sparkline's `viewBox`, stretched to its frame: only the proportions of the curve matter. */
const SPARKLINE_BOX = { width: 100, height: 24 };

const Euros = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

/** Days are calendar dates: written in UTC, so no time zone moves them to the day before. */
const Days = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** A price as the card writes it: an unknown one is a dash, never a zero. */
function formatPrice(price: number | null) {
  if (price === null) {
    return "—";
  }

  return Euros.format(price);
}

/** A `YYYY-MM-DD` day from tcg-collector, as `Oct 11, 2026`. */
function formatDay(day: string) {
  return Days.format(new Date(`${day}T00:00:00Z`));
}

/** A game's name, or its id for one tcg-collector may collect but the card does not know by name. */
function gameName(game: number) {
  return GAME_NAMES.get(game) ?? `Game ${game}`;
}

/** One followed card as loaded: its catalog entry, null when tcg-collector does not know the product, and its days. */
export type FollowedCardPrices = CardImageRef & {
  card: TcgCard | null;
  history: TcgDailyPrices[];
};

/** Which price a curve follows, and that price on each day. */
export type PriceSeries = {
  label: "Trend" | "Low";
  prices: (number | null)[];
};

/** A card's price history, as its sparkline draws it. */
export class PriceCurve {
  /** The trend, or the lowest offer for a card Cardmarket gives no trend: a curve of the cheapest copy beats none. */
  static series(history: readonly TcgDailyPrices[]): PriceSeries {
    const trends = history.map(day => day.trend);
    const hasTrend = trends.some(price => price !== null);

    if (hasTrend) {
      return { label: "Trend", prices: trends };
    }

    return { label: "Low", prices: history.map(day => day.low) };
  }

  /** What the curve shows, for a screen reader: `Trend over 30 days: from €1.20 to €1.45`. */
  static describe({ label, prices }: PriceSeries) {
    const known = prices.filter(price => price !== null);
    const period = `${label} over ${prices.length} ${prices.length === 1 ? "day" : "days"}`;

    if (known.length === 1) {
      return `${period}: ${formatPrice(known[0]!)}`;
    }

    return `${period}: from ${formatPrice(known[0] ?? null)} to ${formatPrice(known.at(-1) ?? null)}`;
  }

  /** The most recent day any of the cards has a price for, `YYYY-MM-DD`; `undefined` when none has one. */
  static latestDay(followed: readonly FollowedCardPrices[]) {
    const lastDays = followed.flatMap(({ history }) => history.at(-1)?.day ?? []);

    // ISO dates sort as text.
    return lastDays.sort().at(-1);
  }
}

/** The price curve of one card, stroked in the text color so it follows the theme. Nothing when it has no price. */
function PriceSparkline({ history }: { history: readonly TcgDailyPrices[] }) {
  const series = PriceCurve.series(history);
  const polylines = Sparkline.polylines(series.prices, SPARKLINE_BOX);

  if (polylines.length === 0) {
    return null;
  }

  // The stroke keeps its width however the box is stretched, and spills past it rather than being clipped.
  return (
    <svg
      role="img"
      aria-label={PriceCurve.describe(series)}
      viewBox={`0 0 ${SPARKLINE_BOX.width} ${SPARKLINE_BOX.height}`}
      preserveAspectRatio="none"
      className="h-6 w-16 shrink-0 overflow-visible text-primary"
    >
      {polylines.map(points => (
        <polyline
          key={points}
          points={points}
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

/** The frame a card's image sits in, kept when there is no image, so every name starts on the same column. */
const THUMBNAIL_CLASSNAME = "block aspect-5/7 w-10 shrink-0 overflow-hidden rounded-sm bg-muted";

/** One card's row: what it is, what it is worth, and how that moved. */
function CardRow({
  followed: { game, product, card, history },
  serviceUrl,
  placementKey,
}: {
  followed: FollowedCardPrices;
  serviceUrl: string;
  placementKey: string;
}) {
  if (!card) {
    return (
      <WidgetListItem media={<span className={THUMBNAIL_CLASSNAME} />}>
        <p className="truncate font-medium text-muted-foreground">Card not found</p>
        <p className="truncate text-xs text-muted-foreground">
          {gameName(game)} · product {product}
        </p>
      </WidgetListItem>
    );
  }

  // tcg-collector's page opens a card's sheet from its address.
  const cardUrl = `${serviceUrl}/?game=${game}&card=${product}`;

  return (
    <WidgetListItem
      media={
        // Decorative: the name beside it is the same link. A card with no image is a 404, which an empty alt hides.
        <a
          href={cardUrl}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          aria-hidden="true"
          className={THUMBNAIL_CLASSNAME}
        >
          <img
            src={WidgetImage.url(placementKey, CardImageId.format({ game, product }))}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      }
      trailing={<PriceSparkline history={history} />}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <a
          href={cardUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate font-medium text-primary hover:underline"
        >
          {card.name}
        </a>
        {card.version !== null && <Badge variant="outline">V.{card.version}</Badge>}
      </div>
      {card.expansion && <p className="truncate text-xs text-muted-foreground">{card.expansion}</p>}
      <p className="truncate text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-primary">
          <span className="sr-only">Trend </span>
          {formatPrice(card.trend)}
        </span>{" "}
        <WidgetMetadata>
          <span>Low {formatPrice(card.low)}</span>
          {/* Most cards have no foil printing: a dash there would read as a missing price. */}
          {card.trendFoil !== null && <span>Foil {formatPrice(card.trendFoil)}</span>}
        </WidgetMetadata>
      </p>
    </WidgetListItem>
  );
}

type TcgCollectorCardsCardProps = {
  /** The followed cards, in the order the declaration lists them. */
  followed: FollowedCardPrices[];
  /** The period the curves cover, as declared. */
  days: number;
  serviceUrl: string;
  /** The placement's key, which its relayed images are addressed by. */
  placementKey: string;
};

export function TcgCollectorCardsCard({ followed, days, serviceUrl, placementKey }: TcgCollectorCardsCardProps) {
  const latestDay = PriceCurve.latestDay(followed);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>
              {followed.length} {followed.length === 1 ? "card" : "cards"}
            </span>
            <span>{days} days</span>
            {latestDay && <span>as of {formatDay(latestDay)}</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList>
          {followed.map((cardPrices, index) => (
            // A card may be listed twice; its place in the list is what tells the two rows apart.
            <CardRow
              key={`${index}-${CardImageId.format(cardPrices)}`}
              followed={cardPrices}
              serviceUrl={serviceUrl}
              placementKey={placementKey}
            />
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/** What a declaration follows: its cards, and the period their curves cover. */
export type FollowedCards = {
  cards: readonly CardImageRef[];
  days: number;
};

/**
 * Each followed card's prices and their curve over the last `days`. A product tcg-collector does not know is a row
 * of its own; a service that does not answer fails the whole card, as every widget does.
 */
export const tcgCollectorCards = (
  service: WidgetService,
  { cards, days }: FollowedCards,
): WidgetBody<FollowedCardPrices[]> => ({
  load: async () => {
    const client = await TcgCollectorClient.connect(service);

    return await Promise.all(
      cards.map(async ({ game, product }) => {
        const [card, history] = await Promise.all([
          client.getCard(game, product),
          client.getDaily(game, product, days),
        ]);

        return { game, product, card, history };
      }),
    );
  },
  render: (followed, placementKey) => (
    <TcgCollectorCardsCard followed={followed} days={days} serviceUrl={service.link} placementKey={placementKey} />
  ),
});
