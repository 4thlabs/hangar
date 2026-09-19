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
}

/** What "latest" means here: the media types the carousel mixes, as Glance's widget does. */
const MEDIA_TYPES = "Movie,Episode,MusicAlbum";

/**
 * Talks to one Jellyfin server.
 *
 * Two things set Jellyfin apart from the other services here: it serves its API at the root
 * rather than under `/api`, and it rejects `X-API-Key` — the key goes in `X-Emby-Token`.
 */
export async function createJellyfinClient(service: WidgetService) {
  const client = await serviceClient(service, { prefix: "", apiKeyHeader: "X-Emby-Token" });

  return {
    /** Gets the server-wide library totals. */
    getCounts: () => client.get<JellyfinCounts>("Items/Counts").json(),

    /** Gets every user, so a name from `hangar.yml` can be turned into the id the API wants. */
    getUsers: () => client.get<JellyfinUser[]>("Users").json(),

    /**
     * Gets the newest items across every library for one user.
     *
     * Per-user on purpose, and not a detail we can skip: Jellyfin's "latest" is scoped to what
     * that user may see, so there is no server-wide answer to ask for.
     */
    getLatest: (userId: string, limit: number) =>
      client
        .get<JellyfinItem[]>(`Users/${userId}/Items/Latest`, {
          searchParams: { Limit: limit, IncludeItemTypes: MEDIA_TYPES, GroupItems: "true" },
        })
        .json(),

    /** Fetches an item's poster as raw bytes, for Hangar to relay without leaking the key. */
    getPoster: (itemId: string) => client.get(`Items/${itemId}/Images/Primary`),
  };
}
