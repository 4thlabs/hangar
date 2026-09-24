import type { MinifluxEntry } from "./api/client.ts";
import { createMinifluxClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";
import { cn } from "cn";

type MinifluxEntriesCardProps = {
  entries: MinifluxEntry[];
  unread: number;
  serviceUrl: string;
  now?: number;
};

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Miniflux", icon: <IconSelfh name="miniflux" /> };

export function MinifluxEntriesCard({ entries, unread, serviceUrl, now = Date.now() }: MinifluxEntriesCardProps) {
  return (
    <WidgetCard>
      <WidgetHeader
        href={serviceUrl}
        icon={chrome.icon}
        title={chrome.title}
        bordered={entries.length > 0}
        description={
          <WidgetMetadata>
            <span>{unread} unread</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No entries.">
          {entries.map(entry => {
            const isUnread = entry.status === "unread";

            return (
              <WidgetListItem
                key={entry.id}
                media={
                  // Kept when read, transparent, so every title starts on the same column.
                  <span
                    className={cn("size-2 shrink-0 rounded-full", isUnread && "bg-primary")}
                    {...(isUnread ? { role: "img", "aria-label": "Unread" } : { "aria-hidden": true })}
                  />
                }
                trailing={<WidgetTime compact at={Date.parse(entry.published_at)} now={now} />}
              >
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  title={entry.feed.title}
                  className={cn(
                    "block truncate hover:underline",
                    isUnread ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  {entry.title}
                </a>
              </WidgetListItem>
            );
          })}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/** The newest feed entries, each marked when not read yet. */
export const minifluxEntries = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "miniflux-entries",
    ttl,
    ...chrome,
    errorDescription: "The feed entries could not be loaded.",
    load: async () => {
      const client = await createMinifluxClient(service);

      return await Promise.all([client.getEntries(), client.getUnreadCount()]);
    },
    render: ([{ entries }, unread]) => (
      <MinifluxEntriesCard entries={entries} unread={unread} serviceUrl={service.link} />
    ),
  });
