/** The Miniflux card's words. */
export class MinifluxMessages {
  static readonly en = {
    title: "Miniflux",
    errorDescription: "The feed entries could not be loaded.",
    unread: ({ count }: { count: number }) => `${count} unread`,
    unreadMark: "Unread",
    empty: "No entries.",
  };

  static readonly fr: typeof MinifluxMessages.en = {
    title: "Miniflux",
    errorDescription: "Les articles des flux n’ont pas pu être chargés.",
    unread: ({ count }) => `${count} non lus`,
    unreadMark: "Non lu",
    empty: "Aucun article.",
  };
}
