import { cn } from "cn";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../shared/index.ts";
import { MinifluxClient, type MinifluxEntries, type MinifluxEntry } from "./api/client.ts";
import { minifluxEntriesDescriptor } from "./descriptor.ts";

const { appearance } = minifluxEntriesDescriptor;

type MinifluxEntriesCardProps = {
  entries: MinifluxEntry[];
  unread: number;
  serviceUrl: string;
  now?: number;
};

export function MinifluxEntriesCard({ entries, unread, serviceUrl, now = Date.now() }: MinifluxEntriesCardProps) {
  return (
    <WidgetCard>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
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
export const minifluxEntries = (service: WidgetService): WidgetBody<[MinifluxEntries, number]> => ({
  load: async () => {
    const client = await MinifluxClient.connect(service);

    return await Promise.all([client.getEntries(), client.getUnreadCount()]);
  },
  render: ([{ entries }, unread]) => (
    <MinifluxEntriesCard entries={entries} unread={unread} serviceUrl={service.link} />
  ),
});
