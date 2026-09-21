import type { JellyfinCounts, JellyfinItem } from "./api/client.ts";
import { createJellyfinClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import { ScrollArea } from "#app/components/ui/scroll-area.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetHeader,
  WidgetMetadata,
  integerFormatter,
  widgetImageUrl,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

/** How many posters the row holds. */
const ITEM_COUNT = 10;

const latestWidgetClassName = "min-h-64";
const jellyfinIcon = <IconSelfh name="jellyfin" />;

/** One poster, already resolved to what the card shows. */
export type LatestItem = {
  /** The item the link points at — the series, for an episode. */
  id: string;
  /** The item whose poster to ask for, or nothing: plenty of libraries have items with no art. */
  imageId: string | undefined;
  title: string;
  subtitle: string | undefined;
};

/**
 * Which item carries the poster.
 *
 * Not the item the card links to: an episode has its own still while the card points at the show,
 * and an album with no cover of its own borrows the one Jellyfin resolved for its parent. Asking
 * for a poster Jellyfin never had is a 404 and a broken image, so `ImageTags` decides.
 */
const imageOf = (item: JellyfinItem) => (item.ImageTags?.Primary ? item.Id : item.ParentPrimaryImageItemId);

/**
 * What a library item looks like on the card.
 *
 * An episode resolves to its series: "latest" lists episodes, but a row of ten stills from the
 * same show is noise where one poster is the answer. Glance's widget makes the same substitution
 * — and so does Jellyfin itself, which returns the series outright when items are grouped.
 */
export function displayItem(item: JellyfinItem): LatestItem {
  const imageId = imageOf(item);

  if (item.Type === "Episode") {
    return { id: item.SeriesId ?? item.Id, imageId, title: item.SeriesName ?? item.Name, subtitle: undefined };
  }

  if (item.Type === "MusicAlbum") {
    return { id: item.Id, imageId, title: item.Name, subtitle: item.AlbumArtist };
  }

  return { id: item.Id, imageId, title: item.Name, subtitle: item.ProductionYear?.toString() };
}

type JellyfinLatestCardProps = {
  counts: JellyfinCounts;
  items: LatestItem[];
  serviceUrl: string;
};

export function JellyfinLatestCard({ counts, items, serviceUrl }: JellyfinLatestCardProps) {
  return (
    <WidgetCard className={latestWidgetClassName}>
      {/* The library totals label the row rather than taking a card of their own: they are what
          the posters are the newest of. `description` draws the divider `bordered` used to. */}
      <WidgetHeader
        href={serviceUrl}
        icon={jellyfinIcon}
        title="Jellyfin"
        description={
          <WidgetMetadata>
            <span>{integerFormatter.format(counts.MovieCount)} movies</span>
            <span>{integerFormatter.format(counts.SeriesCount)} shows</span>
            <span>{integerFormatter.format(counts.EpisodeCount)} episodes</span>
            <span>{integerFormatter.format(counts.SongCount)} songs</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        {items.length > 0 ? (
          // The viewport owns the scrolling, so the row itself no longer sets `overflow-x`. The
          // padding is what the scrollbar sits in, below the titles rather than over them.
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
                    {/* Relayed by Hangar: a direct Jellyfin poster URL carries the API key. An item
                        with no artwork keeps the frame, which is what Jellyfin's own library shows. */}
                    {item.imageId ? (
                      <img
                        src={widgetImageUrl("jellyfin-latest", item.imageId)}
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

/**
 * The library, as one card: what it holds, and what landed in it last.
 *
 * Takes a user name because Jellyfin's "latest" is scoped to what that user may see — there is no
 * server-wide answer to ask for, so the operator names one in `hangar.yml`. The totals are the one
 * thing here that *is* server-wide, which is why they read as the header's subtitle.
 */
export const jellyfinLatest = (service: WidgetService, user: string, ttl?: number) =>
  defineWidget({
    id: "jellyfin-latest",
    ttl,
    title: "Jellyfin",
    icon: jellyfinIcon,
    className: latestWidgetClassName,
    errorDescription: "The Jellyfin library could not be loaded.",
    skeleton: { withSubtitle: true },
    load: async () => {
      const client = await createJellyfinClient(service);
      // Independent calls, so they go together; only "latest" has to wait on the user lookup.
      const [counts, users] = await Promise.all([client.getCounts(), client.getUsers()]);
      const account = users.find(candidate => candidate.Name === user);

      // Naming the operator's own typo beats an error card that says only "could not be loaded".
      if (!account) throw new Error(`No Jellyfin user named ${user}`);

      const items = (await client.getLatest(account.Id, ITEM_COUNT)).map(displayItem);

      // The client over-fetches, because Jellyfin groups only after it has cut the list, so the
      // row is trimmed here instead. The dedupe is for the React key rather than for a bug on
      // record: a grouped response still carries the odd bare episode, and two from one series
      // would both resolve to that series id. Nothing in the current library collides.
      return { counts, items: [...new Map(items.map(item => [item.id, item])).values()].slice(0, ITEM_COUNT) };
    },
    render: ({ counts, items }: { counts: JellyfinCounts; items: LatestItem[] }) => (
      <JellyfinLatestCard counts={counts} items={items} serviceUrl={service.link} />
    ),
  });
