/** The Jellyfin card's words. */
export class JellyfinMessages {
  static readonly en = {
    title: "Jellyfin",
    errorDescription: "The Jellyfin library could not be loaded.",
    movies: ({ count }: { count: string }) => `${count} movies`,
    shows: ({ count }: { count: string }) => `${count} shows`,
    episodes: ({ count }: { count: string }) => `${count} episodes`,
    songs: ({ count }: { count: string }) => `${count} songs`,
    empty: "No items found.",
  };

  static readonly fr: typeof JellyfinMessages.en = {
    title: "Jellyfin",
    errorDescription: "La bibliothèque Jellyfin n’a pas pu être chargée.",
    movies: ({ count }) => `${count} films`,
    shows: ({ count }) => `${count} séries`,
    episodes: ({ count }) => `${count} épisodes`,
    songs: ({ count }) => `${count} morceaux`,
    empty: "Aucun élément trouvé.",
  };
}
