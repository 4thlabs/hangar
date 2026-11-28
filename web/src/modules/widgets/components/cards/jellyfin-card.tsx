import type { JellyfinCounts, ServicesJellyfinParams } from "#libs/api";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { ScrollArea } from "#modules/common/ui/scroll-area.tsx";
import { servicesQueries } from "#modules/widgets/api/services-queries.ts";
import { WidgetFailure, WidgetSkeleton } from "#modules/widgets/components/widget-states.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetHeader,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { jellyfinLatestAsked, jellyfinView, type JellyfinPoster } from "#modules/widgets/helpers/jellyfin-view.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { widgetImageUrl } from "#modules/widgets/helpers/widget-image.ts";
import { useServiceRead } from "#modules/widgets/hooks/use-service-read.ts";
import { m } from "#paraglide/messages.js";

/** What the latest card reads of Jellyfin: what the server holds, and the items added last, which it makes posters of. */
const latestRead = { counts: true, latest: jellyfinLatestAsked } as const satisfies ServicesJellyfinParams;

/** `jellyfin-latest`: what Jellyfin holds, and a row of the posters of what was added last. */
export const jellyfinWidget = defineWidget("jellyfin-latest", {
  icon: WidgetIcon.dashboard("jellyfin"),
  className: "min-h-64",
  title: m.widgets_jellyfin_latest_title,
  errorDescription: m.widgets_jellyfin_latest_error_description,
  card: JellyfinWidget,
});

/** The latest card, read from its service in its own region. */
function JellyfinWidget({ placement }: WidgetProps) {
  const look = widgetLook(jellyfinWidget);
  const read = useServiceRead(servicesQueries.jellyfin, placement.key, latestRead);

  return (
    <QueryRegion
      query={read}
      fallback={<WidgetSkeleton look={look} />}
      failure={failure => <WidgetFailure look={look} {...failure} />}
    >
      {({ counts, latest }) => (
        <JellyfinCard
          counts={counts}
          posters={jellyfinView(latest)}
          placementKey={placement.key}
          link={placement.link}
        />
      )}
    </QueryRegion>
  );
}

type JellyfinCardProps = {
  counts: JellyfinCounts;
  posters: readonly JellyfinPoster[];
  /** The placement's key, which its posters are relayed by. */
  placementKey: string;
  link: string | null;
};

/** What Jellyfin holds, and a row of the posters of what was added last. */
function JellyfinCard({ counts, posters, placementKey, link }: JellyfinCardProps) {
  const look = widgetLook(jellyfinWidget);

  return (
    <WidgetCard className={look.className}>
      {/* The totals of the server label the row: they are what the posters are the newest of. */}
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_jellyfin_movies({ count: counts.movies })}</span>
            <span>{m.widgets_jellyfin_shows({ count: counts.series })}</span>
            <span>{m.widgets_jellyfin_episodes({ count: counts.episodes })}</span>
            <span>{m.widgets_jellyfin_songs({ count: counts.songs })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        {posters.length > 0 ? (
          // The padding is where the scrollbar sits, below the titles rather than over them.
          <ScrollArea orientation="horizontal" className="w-full">
            <ul className="flex snap-x gap-3 pb-3">
              {posters.map(poster => (
                <li key={poster.id} className="w-28 shrink-0 snap-start">
                  <a
                    {...(link ? { href: `${link}/web/#/details?id=${encodeURIComponent(poster.id)}` } : {})}
                    target="_blank"
                    rel="noreferrer"
                    className="group block"
                  >
                    {/* An item with no artwork keeps the frame, as Jellyfin's own library does. */}
                    {poster.imageId ? (
                      <img
                        src={widgetImageUrl(placementKey, poster.imageId)}
                        alt=""
                        loading="lazy"
                        className="aspect-2/3 w-full rounded-sm bg-muted object-cover"
                      />
                    ) : (
                      <div className="aspect-2/3 w-full rounded-sm bg-muted" />
                    )}
                    <p className="mt-1 truncate text-xs font-medium text-primary group-hover:underline">
                      {poster.title}
                    </p>
                    {poster.subtitle && <p className="truncate text-xs text-muted-foreground">{poster.subtitle}</p>}
                  </a>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <WidgetEmptyState>{m.widgets_jellyfin_empty()}</WidgetEmptyState>
        )}
      </WidgetContent>
    </WidgetCard>
  );
}
