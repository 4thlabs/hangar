/** The Forgejo Actions card's words. */
export class ForgejoMessages {
  static readonly en = {
    title: "Forgejo",
    errorDescription: "The Forgejo Actions runs could not be loaded.",
    repos: ({ count }: { count: number }) => (count === 1 ? "1 repo" : `${count} repos`),
    running: ({ count }: { count: number }) => `${count} running`,
    queued: ({ count }: { count: number }) => `${count} queued`,
    empty: "Nothing running.",
    recent: "Recently updated",
  };

  static readonly fr: typeof ForgejoMessages.en = {
    title: "Forgejo",
    errorDescription: "Les exécutions Forgejo Actions n’ont pas pu être chargées.",
    repos: ({ count }) => (count > 1 ? `${count} dépôts` : `${count} dépôt`),
    running: ({ count }) => `${count} en cours`,
    queued: ({ count }) => `${count} en attente`,
    empty: "Rien en cours.",
    recent: "Mis à jour récemment",
  };
}
