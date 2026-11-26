import { cn } from "cn";
import type { MinifluxEntries } from "#libs/api";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
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
  /** For a test that pins the clock. */
  now?: number;
};

/** Miniflux's newest entries, each marked when not read yet, and how many are unread. */
export function MinifluxCard({ entries: { unread, entries }, link, now = Date.now() }: MinifluxCardProps) {
  const look = WidgetAppearance.get("miniflux-entries");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        bordered={entries.length > 0}
        description={
          <WidgetMetadata>
            <span>{Units.integer(unread)} unread</span>
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
