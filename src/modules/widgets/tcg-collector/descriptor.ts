import * as z from "zod";
import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";
import { TcgCollectorMessages } from "./messages.ts";

/** A Cardmarket id as tcg-collector's API accepts one, `^\d{1,9}$`: a whole number of at most nine digits. */
const cardmarketId = z.int().min(0).max(999_999_999);

/** The most days of prices tcg-collector serves: ten years. */
const MAX_DAYS = 3650;

/** How many days the price curves cover when the declaration does not say. */
const DEFAULT_DAYS = 30;

/** How many cards one widget follows at most: each costs two calls on every refresh. */
const MAX_CARDS = 20;

/** One version of a card. Every version has its own Cardmarket idProduct, which is how one is picked. */
const followedCard = z.object({
  /** Cardmarket's game id: 1 for Magic, 21 for Star Wars Unlimited. */
  game: cardmarketId,
  product: cardmarketId,
});

/** Trading cards tracked by tcg-collector: their prices and price curves, with their images relayed through Hangar. */
export const tcgCollectorCardsDescriptor = describeWidget({
  schema: WidgetSchema.service("tcg-collector-cards").extend({
    days: z.int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
    cards: z.array(followedCard).min(1).max(MAX_CARDS).readonly(),
  }),
  app: "tcg-collector",
  appearance: {
    messages: TcgCollectorMessages,
    icon: new WidgetIcon("/images/widgets/tcg-collector.svg"),
    className: "min-h-48",
  },
  module: () => import("./cards.tsx"),
  create: ({ tcgCollectorCards }, config, service) => tcgCollectorCards(service(), config),
  relay: async (service, id) => {
    const { CardImageId, TcgCollectorClient } = await import("./api/index.ts");
    const card = CardImageId.parse(id);

    if (!card) {
      return undefined;
    }

    return (await TcgCollectorClient.connect(service)).getImage(card.game, card.product);
  },
});
