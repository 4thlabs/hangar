import type { JellyfinLatest } from "#libs/api";
import { ScrollArea } from "#modules/common/ui/scroll-area.tsx";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetImage } from "#modules/widgets/widget-image.ts";
import { WidgetCard, WidgetContent, WidgetEmptyState, WidgetHeader, WidgetMetadata } from "../widget.tsx";

type JellyfinCardProps = {
  latest: JellyfinLatest;
  /** The placement's key, which its posters are relayed by. */
  placementKey: string;
  link: string | null;
};

/** What Jellyfin holds, and a row of the posters of what was added last. */
export function JellyfinCard({ latest: { counts, items }, placementKey, link }: JellyfinCardProps) {
  const look = WidgetAppearance.get("jellyfin-latest");

  return (
    <WidgetCard className={look.className}>
      {/* The totals of the server label the row: they are what the posters are the newest of. */}
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{Units.integer(counts.movies)} movies</span>
            <span>{Units.integer(counts.series)} shows</span>
            <span>{Units.integer(counts.episodes)} episodes</span>
            <span>{Units.integer(counts.songs)} songs</span>
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
                    {...(link ? { href: `${link}/web/#/details?id=${encodeURIComponent(item.id)}` } : {})}
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
