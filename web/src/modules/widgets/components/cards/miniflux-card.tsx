import { cn } from "cn";
import type { MinifluxEntries } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

/** `miniflux-entries`: Miniflux's newest entries. */
export const minifluxWidget = defineWidget("miniflux-entries", {
  icon: WidgetIcon.dashboard("miniflux", "miniflux-light"),
  title: m.widgets_miniflux_entries_title,
  errorDescription: m.widgets_miniflux_entries_error_description,
  card: MinifluxWidget,
});

/** The card, with what it loaded of `GET /widgets/{key}`, in its own region. */
function MinifluxWidget({ placement }: WidgetProps) {
  return (
    <LoadedWidget placement={placement} type="miniflux-entries" look={widgetLook(minifluxWidget)}>
      {entries => <MinifluxCard entries={entries} link={placement.link} />}
    </LoadedWidget>
  );
}

type MinifluxCardProps = {
  entries: MinifluxEntries;
  link: string | null;
};

/** Miniflux's newest entries, each marked when not read yet, and how many are unread. */
export function MinifluxCard({ entries: { unread, entries }, link }: MinifluxCardProps) {
  const now = useNow();
  const look = widgetLook(minifluxWidget);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        bordered={entries.length > 0}
        description={
          <WidgetMetadata>
            <span>{m.widgets_miniflux_unread({ count: unread })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={m.widgets_miniflux_empty()}>
          {entries.map(entry => (
            <WidgetListItem
              key={entry.id}
              media={
                // Kept when read, transparent, so that every title starts on the same column.
                <span
                  className={cn("size-2 shrink-0 rounded-full", entry.isUnread && "bg-primary")}
                  {...(entry.isUnread
                    ? { role: "img", "aria-label": m.widgets_miniflux_unread_mark() }
                    : { "aria-hidden": true })}
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
