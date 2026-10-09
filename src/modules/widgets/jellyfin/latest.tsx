import { ScrollArea } from "#modules/common/ui/scroll-area.tsx";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  Units,
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetHeader,
  WidgetImage,
  WidgetMetadata,
} from "../shared/index.ts";
import { JellyfinClient, type JellyfinCounts, type JellyfinItem } from "./api/client.ts";
import { jellyfinLatestDescriptor } from "./descriptor.ts";

const { appearance } = jellyfinLatestDescriptor;

/** How many posters the row holds. */
const ITEM_COUNT = 10;

/** One poster, already resolved to what the card shows. */
export type LatestItem = {
  /** The item the link points at — the series, for an episode. */
  id: string;
  /** The item whose poster to ask for, or nothing: plenty of libraries have items with no art. */
  imageId: string | undefined;
  title: string;
  subtitle: string | undefined;
};

/** A Jellyfin library item, resolved to the poster the card shows. */
export class JellyfinPoster {
  /**
   * What a library item looks like on the card. An episode resolves to its series: one poster per show, not ten
   * stills.
   */
  static display(item: JellyfinItem): LatestItem {
    const imageId = JellyfinPoster.imageId(item);

    if (item.Type === "Episode") {
      return { id: item.SeriesId ?? item.Id, imageId, title: item.SeriesName ?? item.Name, subtitle: undefined };
    }

    if (item.Type === "MusicAlbum") {
      return { id: item.Id, imageId, title: item.Name, subtitle: item.AlbumArtist };
    }

    return { id: item.Id, imageId, title: item.Name, subtitle: item.ProductionYear?.toString() };
  }

  /**
   * Which item carries the poster: the item if `ImageTags` lists one, else the parent Jellyfin resolved (an album
   * without a cover). Asking for a missing poster is a broken image.
   */
  private static imageId(item: JellyfinItem) {
    return item.ImageTags?.Primary ? item.Id : item.ParentPrimaryImageItemId;
  }
}

type JellyfinLatestCardProps = {
  counts: JellyfinCounts;
  items: LatestItem[];
  serviceUrl: string;
  /** The placement's key, which its relayed posters are addressed by. */
  placementKey: string;
};

export function JellyfinLatestCard({ counts, items, serviceUrl, placementKey }: JellyfinLatestCardProps) {
  return (
    <WidgetCard className={appearance.className}>
      {/* The server-wide totals label the row: they are what the posters are the newest of. */}
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>{Units.Integer.format(counts.MovieCount)} movies</span>
            <span>{Units.Integer.format(counts.SeriesCount)} shows</span>
            <span>{Units.Integer.format(counts.EpisodeCount)} episodes</span>
            <span>{Units.Integer.format(counts.SongCount)} songs</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        {items.length > 0 ? (
          // The padding is where the scrollbar sits, below the titles rather than over them.
          <ScrollArea orientation="horizontal" className="w-full">
            <ul className="flex snap-x gap-3 pb-3">
              {items.map(item => (
                <li key={item.id} className="w-28 shrink-0 snap-start">
                  <a
                    href={`${serviceUrl}/web/#/details?id=${encodeURIComponent(item.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block"
                  >
                    {/* An item with no artwork keeps the frame, as Jellyfin's own library does. */}
                    {item.imageId ? (
                      <img
                        src={WidgetImage.url(placementKey, item.imageId)}
                        alt=""
                        loading="lazy"
                        className="aspect-2/3 w-full rounded-sm bg-muted object-cover"
                      />
                    ) : (
                      <div className="aspect-2/3 w-full rounded-sm bg-muted" />
                    )}
                    <p className="mt-1 truncate text-xs font-medium text-primary group-hover:underline">{item.title}</p>
                    {item.subtitle && <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                  </a>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <WidgetEmptyState>No items found.</WidgetEmptyState>
        )}
      </WidgetContent>
    </WidgetCard>
  );
}

/** The library, as one card: what it holds, and what landed in it last, as `user` sees it. */
export const jellyfinLatest = (
  service: WidgetService,
  user: string,
): WidgetBody<{ counts: JellyfinCounts; items: LatestItem[] }> => ({
  load: async () => {
    const client = await JellyfinClient.connect(service);
    // Independent calls, so they go together; only "latest" has to wait on the user lookup.
    const [counts, users] = await Promise.all([client.getCounts(), client.getUsers()]);
    const account = users.find(candidate => candidate.Name === user);

    // Naming the operator's own typo beats an error card that says only "could not be loaded".
    if (!account) {
      throw new Error(`No Jellyfin user named ${user}`);
    }

    const items = (await client.getLatest(account.Id, ITEM_COUNT)).map(JellyfinPoster.display);

    // The client over-fetches, so trim here. Grouped responses can still repeat a series (unique React keys).
    return { counts, items: [...new Map(items.map(item => [item.id, item])).values()].slice(0, ITEM_COUNT) };
  },
  render: ({ counts, items }, placementKey) => (
    <JellyfinLatestCard counts={counts} items={items} serviceUrl={service.link} placementKey={placementKey} />
  ),
});
