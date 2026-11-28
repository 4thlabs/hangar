import type { JellyfinItem } from "#libs/api";

/** How many posters the latest card shows. */
const posterCount = 10;

/**
 * How many of the items added last the card asks: ten times the posters it shows, as Jellyfin cuts its list before it
 * groups the episodes by series.
 */
export const jellyfinLatestAsked = posterCount * 10;

/** A poster of the latest card. */
export type JellyfinPoster = {
  /** The item it opens: the series, for an episode. */
  id: string;
  /** Its image, as the server named it for its relay; `null` when it has none. */
  imageId: string | null;
  /** Its title, or its series'. */
  title: string;
  /** The artist of an album, or the year of another item. */
  subtitle: string | null;
};

/** An item as its poster shows it: an episode as its series, an album by its artist, anything else by its year. */
function poster(item: JellyfinItem): JellyfinPoster {
  switch (item.kind) {
    case "Episode":
      return {
        id: item.seriesId ?? item.id,
        imageId: item.imageId,
        title: item.seriesName ?? item.name,
        subtitle: null,
      };
    case "MusicAlbum":
      return { id: item.id, imageId: item.imageId, title: item.name, subtitle: item.albumArtist };
    default:
      return {
        id: item.id,
        imageId: item.imageId,
        title: item.name,
        subtitle: item.productionYear === null ? null : String(item.productionYear),
      };
  }
}

/** The posters of what was added to Jellyfin last, newest first: one per show rather than ten stills, the first ten. */
export function jellyfinView(latest: readonly JellyfinItem[]): JellyfinPoster[] {
  const seen = new Set<string>();
  const posters: JellyfinPoster[] = [];

  // A grouped list may still name a series twice.
  for (const item of latest.map(poster)) {
    if (posters.length === posterCount) {
      break;
    }

    if (!seen.has(item.id)) {
      seen.add(item.id);
      posters.push(item);
    }
  }

  return posters;
}
