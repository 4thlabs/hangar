import { cn } from "cn";
import { IconSelfh } from "#modules/common/components/icon-selfh.tsx";
import type { WidgetService } from "../config/config.ts";
import { defineWidget } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../shared/index.ts";
import { MinifluxClient, type MinifluxEntry } from "./api/client.ts";

type MinifluxEntriesCardProps = {
  entries: MinifluxEntry[];
  unread: number;
  serviceUrl: string;
  now?: number;
};

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
                trailing={<WidgetTime style="compact" at={Date.parse(entry.published_at)} now={now} />}
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
      const client = await MinifluxClient.connect(service);

      return await Promise.all([client.getEntries(), client.getUnreadCount()]);
    },
    render: ([{ entries }, unread]) => (
      <MinifluxEntriesCard entries={entries} unread={unread} serviceUrl={service.link} />
    ),
  });
