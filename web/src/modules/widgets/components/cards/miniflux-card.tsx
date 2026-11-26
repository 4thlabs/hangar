import { cn } from "cn";
import type { MinifluxEntries } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatInteger } from "#modules/widgets/helpers/widget-format.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../widget.tsx";

type MinifluxCardProps = {
  entries: MinifluxEntries;
  link: string | null;
};

/** Miniflux's newest entries, each marked when not read yet, and how many are unread. */
export function MinifluxCard({ entries: { unread, entries }, link }: MinifluxCardProps) {
  const now = useNow();
  const look = widgetLook("miniflux-entries");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        bordered={entries.length > 0}
        description={
          <WidgetMetadata>
            <span>{formatInteger(unread)} unread</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No entries.">
          {entries.map(entry => (
            <WidgetListItem
              key={entry.id}
              media={
                // Kept when read, transparent, so that every title starts on the same column.
                <span
                  className={cn("size-2 shrink-0 rounded-full", entry.isUnread && "bg-primary")}
                  {...(entry.isUnread ? { role: "img", "aria-label": "Unread" } : { "aria-hidden": true })}
                />
              }
              trailing={<WidgetTime at={Date.parse(entry.publishedAt)} now={now} variant="compact" />}
            >
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                title={entry.feedTitle}
                className={cn(
                  "block truncate hover:underline",
                  entry.isUnread ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                {entry.title}
              </a>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
