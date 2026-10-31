import { Plural } from "#libs/i18n";

/** The TCG Collector card's words. */
export class TcgCollectorMessages {
  static readonly en = {
    title: "TCG Collector",
    errorDescription: "The card prices could not be loaded.",
    cards: ({ count }: { count: number }) => `${count} ${Plural.select("en", count, { one: "card", other: "cards" })}`,
    days: ({ count }: { count: number }) => `${count} ${Plural.select("en", count, { one: "day", other: "days" })}`,
    asOf: ({ day }: { day: string }) => `as of ${day}`,
    notFound: "Card not found",
    game: ({ id }: { id: number }) => `Game ${id}`,
    product: ({ id }: { id: number }) => `product ${id}`,
    /** The prices a card has, and the curve that follows one of them. */
    price: { trend: "Trend", low: "Low", foil: "Foil" },
    over: ({ label, days }: { label: string; days: string }) => `${label} over ${days}`,
    single: ({ period, price }: { period: string; price: string }) => `${period}: ${price}`,
    range: ({ period, from, to }: { period: string; from: string; to: string }) => `${period}: from ${from} to ${to}`,
  };

  static readonly fr: typeof TcgCollectorMessages.en = {
    title: "TCG Collector",
    errorDescription: "Les prix des cartes n’ont pas pu être chargés.",
    cards: ({ count }) => `${count} ${Plural.select("fr", count, { one: "carte", other: "cartes" })}`,
    days: ({ count }) => `${count} ${Plural.select("fr", count, { one: "jour", other: "jours" })}`,
    asOf: ({ day }) => `au ${day}`,
    notFound: "Carte introuvable",
    game: ({ id }) => `Jeu ${id}`,
    product: ({ id }) => `produit ${id}`,
    price: { trend: "Tendance", low: "Plus bas", foil: "Foil" },
    over: ({ label, days }) => `${label} sur ${days}`,
    single: ({ period, price }) => `${period} : ${price}`,
    range: ({ period, from, to }) => `${period} : de ${from} à ${to}`,
  };
}
