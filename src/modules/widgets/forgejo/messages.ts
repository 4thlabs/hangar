import { Plural } from "#libs/i18n";

/** The Forgejo Actions card's words. */
export class ForgejoMessages {
  static readonly en = {
    title: "Forgejo",
    errorDescription: "The Forgejo Actions runs could not be loaded.",
    repos: ({ count }: { count: number }) => `${count} ${Plural.select("en", count, { one: "repo", other: "repos" })}`,
    running: ({ count }: { count: number }) => `${count} running`,
    queued: ({ count }: { count: number }) => `${count} queued`,
    empty: "Nothing running.",
    recent: "Recently updated",
  };

  static readonly fr: typeof ForgejoMessages.en = {
    title: "Forgejo",
    errorDescription: "Les exécutions Forgejo Actions n’ont pas pu être chargées.",
    repos: ({ count }) => `${count} ${Plural.select("fr", count, { one: "dépôt", other: "dépôts" })}`,
    running: ({ count }) => `${count} en cours`,
    queued: ({ count }) => `${count} en attente`,
    empty: "Rien en cours.",
    recent: "Mis à jour récemment",
  };
}
