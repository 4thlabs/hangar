import { Translation, type Translate } from "#libs/i18n";
import { Locale, type LocaleCode } from "#libs/preferences";
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
  WidgetSparkline,
} from "../shared/index.ts";
import { CardImageId, TcgCollectorClient, type CardImageRef, type TcgCard, type TcgDailyPrices } from "./api/index.ts";
import { tcgCollectorCardsDescriptor } from "./descriptor.ts";
import { TcgCollectorMessages } from "./messages.ts";

const { appearance } = tcgCollectorCardsDescriptor;

/** The games tcg-collector collects, by Cardmarket game id. */
const GAME_NAMES: ReadonlyMap<number, string> = new Map([
  [1, "Magic"],
  [21, "Star Wars Unlimited"],
]);

const MS_PER_DAY = 86_400_000;

/** The words of the card, in the reader's language. */
type CardsTranslate = Translate<typeof TcgCollectorMessages.en>;

/** How the card writes prices and days, in the reader's language. */
class CardFormat {
  /** A price in euros: an unknown one is a dash, never a zero. */
  static price(price: number | null, locale: LocaleCode) {
    if (price === null) {
      return "—";
    }

    return new Intl.NumberFormat(Locale.intlTag(locale), { style: "currency", currency: "EUR" }).format(price);
  }

  /**
   * A `YYYY-MM-DD` day from tcg-collector, as `Oct 11, 2026`. Days are calendar dates: written in UTC, so no time
   * zone moves them to the day before.
   */
  static day(day: string, locale: LocaleCode) {
    return new Intl.DateTimeFormat(Locale.intlTag(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));
  }
}

/** A `YYYY-MM-DD` day as a count of days, so two days subtract to the number of days between them. */
function dayNumber(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY;
}

/**
 * The tcg-collector page's sheet of one card, which it opens from its address. A `link` written with a trailing slash
 * would otherwise give `//?game=…`, a path the page does not serve.
 */
function cardPageUrl(serviceUrl: string, { game, product }: CardImageRef) {
  return `${serviceUrl.replace(/\/+$/, "")}/?game=${game}&card=${product}`;
}

/** A game's name, or its id for one tcg-collector may collect but the card does not know by name. */
function gameName(game: number, t: CardsTranslate) {
  return GAME_NAMES.get(game) ?? t("game", { id: game });
}

/** One followed card as loaded: its catalog entry, null when tcg-collector does not know the product, and its days. */
export type FollowedCardPrices = CardImageRef & {
  card: TcgCard | null;
  history: TcgDailyPrices[];
};

/**
 * The days every curve of the card spans: the declared period, ending on the most recent day any card has a price
 * for. Shared, so the rows read on one time axis: a card added three days ago fills the last three days, not the width.
 */
export type PriceWindow = {
  days: number;
  /** `YYYY-MM-DD`. */
  lastDay: string;
};

/** Which price a curve follows, and that price on each day of the window, oldest first; null where it has none. */
export type PriceSeries = {
  label: "trend" | "low";
  prices: (number | null)[];
};

/** A card's price history, as its sparkline draws it. */
export class PriceCurve {
  /**
   * The trend over the window, or the lowest offer for a card Cardmarket gives no trend: a curve of the cheapest copy
   * beats none. A day outside the window is left out.
   */
  static series(history: readonly TcgDailyPrices[], { days, lastDay }: PriceWindow): PriceSeries {
    const hasTrend = history.some(entry => entry.trend !== null);
    const label = hasTrend ? "trend" : "low";
    const prices = Array.from<number | null>({ length: days }).fill(null);
    const lastSlot = days - 1;

    for (const entry of history) {
      const slot = lastSlot - (dayNumber(lastDay) - dayNumber(entry.day));

      if (slot >= 0 && slot <= lastSlot) {
        prices[slot] = hasTrend ? entry.trend : entry.low;
      }
    }

    return { label, prices };
  }

  /** What the curve shows, for a screen reader: `Trend over 30 days: from €1.20 to €1.45`. */
  static describe({ label, prices }: PriceSeries, locale: LocaleCode) {
    const t = Translation.create(TcgCollectorMessages, locale);
    const known = prices.filter(price => price !== null);
    const period = t("over", { label: t(`price.${label}`), days: t("days", { count: prices.length }) });

    if (known.length === 1) {
      return t("single", { period, price: CardFormat.price(known[0]!, locale) });
    }

    const from = CardFormat.price(known[0] ?? null, locale);
    const to = CardFormat.price(known.at(-1) ?? null, locale);

    return t("range", { period, from, to });
  }

  /** The most recent day any of the cards has a price for, `YYYY-MM-DD`; `undefined` when none has one. */
  static latestDay(followed: readonly FollowedCardPrices[]) {
    const lastDays = followed.flatMap(({ history }) => history.at(-1)?.day ?? []);

    // ISO dates sort as text.
    return lastDays.sort().at(-1);
  }
}

/** The price curve of one card. Nothing when it has no price. */
function PriceSparkline({
  history,
  priceWindow,
  locale,
}: {
  history: readonly TcgDailyPrices[];
  priceWindow: PriceWindow;
  locale: LocaleCode;
}) {
  const series = PriceCurve.series(history, priceWindow);

  return <WidgetSparkline prices={series.prices} label={PriceCurve.describe(series, locale)} />;
}

/** The frame a card's image sits in, kept when there is no image, so every name starts on the same column. */
const THUMBNAIL_CLASSNAME = "block aspect-5/7 w-10 shrink-0 overflow-hidden rounded-sm bg-muted";

/** One card's row: what it is, what it is worth, and how that moved. */
function CardRow({
  followed: { game, product, card, history },
  priceWindow,
  serviceUrl,
  placementKey,
  locale,
}: {
  followed: FollowedCardPrices;
  /** The curves' common window; absent when no card has a price yet. */
  priceWindow: PriceWindow | undefined;
  serviceUrl: string;
  placementKey: string;
  locale: LocaleCode;
}) {
  const t = Translation.create(TcgCollectorMessages, locale);
  const price = (value: number | null) => CardFormat.price(value, locale);

  if (!card) {
    return (
      <WidgetListItem media={<span className={THUMBNAIL_CLASSNAME} />}>
        <p className="truncate font-medium text-muted-foreground">{t("notFound")}</p>
        <p className="truncate text-xs text-muted-foreground">
          {gameName(game, t)} · {t("product", { id: product })}
        </p>
      </WidgetListItem>
    );
  }

  const cardUrl = cardPageUrl(serviceUrl, { game, product });

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
      trailing={priceWindow && <PriceSparkline history={history} priceWindow={priceWindow} locale={locale} />}
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
      {/* A flex gap spaces the separators `WidgetMetadata` puts between the prices, as the header's own description does. */}
      <p className="flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <span className="text-sm font-semibold text-primary">
          <span className="sr-only">{t("price.trend")} </span>
          {price(card.trend)}
        </span>
        <WidgetMetadata>
          <span>
            {t("price.low")} {price(card.low)}
          </span>
          {/* Most cards have no foil printing: a dash there would read as a missing price. */}
          {card.trendFoil !== null && (
            <span>
              {t("price.foil")} {price(card.trendFoil)}
            </span>
          )}
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
  locale: LocaleCode;
};

export function TcgCollectorCardsCard({
  followed,
  days,
  serviceUrl,
  placementKey,
  locale,
}: TcgCollectorCardsCardProps) {
  const t = Translation.create(TcgCollectorMessages, locale);
  const latestDay = PriceCurve.latestDay(followed);
  const priceWindow = latestDay === undefined ? undefined : { days, lastDay: latestDay };

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={t("title")}
        description={
          <WidgetMetadata>
            <span>{t("cards", { count: followed.length })}</span>
            <span>{t("days", { count: days })}</span>
            {latestDay && <span>{t("asOf", { day: CardFormat.day(latestDay, locale) })}</span>}
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
              priceWindow={priceWindow}
              serviceUrl={serviceUrl}
              placementKey={placementKey}
              locale={locale}
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
  render: (followed, placementKey, locale) => (
    <TcgCollectorCardsCard
      followed={followed}
      days={days}
      serviceUrl={service.link}
      placementKey={placementKey}
      locale={locale}
    />
  ),
});
