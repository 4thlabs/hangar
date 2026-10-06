import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

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

/**
 * Talks to one Jellyfin server. Its API is at the root, and the key goes in `Authorization: MediaBrowser Token="..."`,
 * the only scheme Jellyfin 12 accepts.
 */
export class JellyfinClient extends ServiceClient {
  /** What "latest" means here: the media types the carousel mixes, as Glance's widget does. */
  private static readonly MediaTypes = "Movie,Episode,MusicAlbum";

  /** Jellyfin applies `limit` before grouping: ask for 10× and trim. */
  private static readonly Overfetch = 10;

  static async connect(service: WidgetService) {
    const token = async () => {
      const key = await service.apiKey();

      return key === undefined ? undefined : `MediaBrowser Token="${key}"`;
    };

    return new JellyfinClient(
      await ServiceClient.client({ api: service.api, apiKey: token }, { prefix: "", apiKeyHeader: "Authorization" }),
    );
  }

  getCounts() {
    return this.http.get<JellyfinCounts>("Items/Counts").json();
  }

  /** Every user, so a name from `hangar.yml` can be turned into the id the API wants. */
  getUsers() {
    return this.http.get<JellyfinUser[]>("Users").json();
  }

  /** The newest items across every library, as one user may see them: Jellyfin has no server-wide "latest". */
  getLatest(userId: string, limit: number) {
    return this.http
      .get<JellyfinItem[]>("Items/Latest", {
        searchParams: {
          userId,
          // Grouping happens after the cut, so the caller trims what comes back. See Overfetch.
          limit: limit * JellyfinClient.Overfetch,
          includeItemTypes: JellyfinClient.MediaTypes,
          groupItems: "true",
          // The card reads only the poster's tag.
          enableImageTypes: "Primary",
        },
      })
      .json();
  }

  /** An item's poster as raw bytes, for `WidgetImages` to relay. */
  getPoster(itemId: string) {
    return this.http.get(`Items/${itemId}/Images/Primary`);
  }
}
