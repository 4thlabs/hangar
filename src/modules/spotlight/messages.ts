/** The search palette's words; each source names itself. */
export class SpotlightMessages {
  static readonly en = {
    searchEverywhere: "Search everywhere",
    searchEverywhereShortcut: ({ shortcut }: { shortcut: string }) => `Search everywhere (${shortcut})`,
    search: "Search",
    placeholder: "Search for an app, a page…",
    scopedPlaceholder: ({ source }: { source: string }) => `Search in ${source}…`,
    loading: "Loading…",
    empty: "No results.",
    sourceFailed: ({ source }: { source: string }) => `${source}: could not load.`,
  };

  static readonly fr: typeof SpotlightMessages.en = {
    searchEverywhere: "Rechercher partout",
    searchEverywhereShortcut: ({ shortcut }) => `Rechercher partout (${shortcut})`,
    search: "Rechercher",
    placeholder: "Rechercher une app, une page…",
    scopedPlaceholder: ({ source }) => `Rechercher dans ${source}…`,
    loading: "Chargement…",
    empty: "Aucun résultat.",
    sourceFailed: ({ source }) => `${source} : chargement impossible.`,
  };
}
