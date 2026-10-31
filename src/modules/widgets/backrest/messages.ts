import { Plural } from "#libs/i18n";

/** The Backrest card's words. */
export class BackrestMessages {
  static readonly en = {
    title: "Backrest",
    errorDescription: "The backup status could not be loaded.",
    repos: ({ count }: { count: number }) => `${count} ${Plural.select("en", count, { one: "repo", other: "repos" })}`,
    protected: ({ size }: { size: string }) => `${size} protected`,
    added: ({ size }: { size: string }) => `${size} added`,
    successes: ({ count }: { count: number }) => `${count} ok / 30d`,
    next: ({ when }: { when: string }) => `next ${when}`,
    empty: "No repositories configured.",
    noBackup: "No backup yet",
  };

  static readonly fr: typeof BackrestMessages.en = {
    title: "Backrest",
    errorDescription: "L’état des sauvegardes n’a pas pu être chargé.",
    repos: ({ count }) => `${count} ${Plural.select("fr", count, { one: "dépôt", other: "dépôts" })}`,
    protected: ({ size }) => `${size} protégés`,
    added: ({ size }) => `${size} ajoutés`,
    successes: ({ count }) => `${count} ok / 30 j`,
    next: ({ when }) => `prochaine ${when}`,
    empty: "Aucun dépôt configuré.",
    noBackup: "Pas encore de sauvegarde",
  };
}
