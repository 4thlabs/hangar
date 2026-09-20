import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";

/** The library totals Jellyfin reports for the whole server. */
export interface JellyfinCounts {
  MovieCount: number;
  SeriesCount: number;
  EpisodeCount: number;
  SongCount: number;
}

/** One Jellyfin user, as `/Users` lists them. */
export interface JellyfinUser {
  Id: string;
  Name: string;
}

/** The subset of a library item Hangar displays. */
export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesId?: string;
  SeriesName?: string;
  AlbumArtist?: string;
  ProductionYear?: number;
  /** Which images the item carries. An item with no `Primary` has no poster to ask for. */
  ImageTags?: Record<string, string>;
  /** Where the poster lives when the item has none of its own — an album's, a season's. */
  ParentPrimaryImageItemId?: string;
}

/** What "latest" means here: the media types the carousel mixes, as Glance's widget does. */
const MEDIA_TYPES = "Movie,Episode,MusicAlbum";

/**
 * How many raw items to ask for per item wanted.
 *
 * Jellyfin applies `limit` *before* `groupItems`, so a run of episodes from one series collapses
 * into a single row after the cut: asking for ten returned exactly one here, the whole reason
 * this exists. Measured against a real library — ten raw items grouped to 1, sixty to 10, a
 * hundred to 43. Ten per item wanted leaves room for a season added in one go.
 */
const OVERFETCH = 10;

/**
 * Talks to one Jellyfin server.
 *
 * Two things set Jellyfin apart from the other services here: it serves its API at the root
 * rather than under `/api`, and it takes no key header of its own — since 12.0 the only scheme
 * left is `Authorization: MediaBrowser Token="..."`, the legacy `X-Emby-Token` and `api_key`
 * having been dropped, so an otherwise valid key sent the old way answers 401 on every call.
 */
export async function createJellyfinClient(service: WidgetService) {
  const token = async () => {
    const key = await service.apiKey();

    return key === undefined ? undefined : `MediaBrowser Token="${key}"`;
  };
  const client = await serviceClient({ ...service, apiKey: token }, { prefix: "", apiKeyHeader: "Authorization" });

  return {
    /** Gets the server-wide library totals. */
    getCounts: () => client.get<JellyfinCounts>("Items/Counts").json(),

    /** Gets every user, so a name from `hangar.yml` can be turned into the id the API wants. */
    getUsers: () => client.get<JellyfinUser[]>("Users").json(),

    /**
     * Gets the newest items across every library for one user.
     *
     * Per-user on purpose, and not a detail we can skip: Jellyfin's "latest" is scoped to what
     * that user may see, so there is no server-wide answer to ask for — 12.0 moved that scope
     * from the path (`Users/{id}/Items/Latest`, now gone) to the `userId` parameter.
     */
    getLatest: (userId: string, limit: number) =>
      client
        .get<JellyfinItem[]>("Items/Latest", {
          searchParams: {
            userId,
            // Grouping happens after the cut, so the caller trims what comes back. See OVERFETCH.
            limit: limit * OVERFETCH,
            includeItemTypes: MEDIA_TYPES,
            groupItems: "true",
            // Not a fix, a trim: the response carries a tag per image type and the card reads
            // only the poster. Worth the parameter now that the limit is ten times what it was.
            enableImageTypes: "Primary",
          },
        })
        .json(),

    /** Fetches an item's poster as raw bytes, for Hangar to relay without leaking the key. */
    getPoster: (itemId: string) => client.get(`Items/${itemId}/Images/Primary`),
  };
}
