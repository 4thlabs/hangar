import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";

/** The subset of a Miniflux entry displayed by Hangar. */
export interface MinifluxEntry {
  id: number;
  title: string;
  url: string;
  published_at: string;
  status: "read" | "unread" | "removed";
  feed: { title: string };
}

interface MinifluxEntries {
  total: number;
  entries: MinifluxEntry[];
}

/** Talks to one Miniflux instance. */
export async function createMinifluxClient(service: WidgetService) {
  const client = await serviceClient(service, { prefix: "/v1", apiKeyHeader: "X-Auth-Token" });

  return {
    /** Gets the newest entries, read or not. */
    getEntries: (limit: number = 8) =>
      client
        .get<MinifluxEntries>("entries", { searchParams: { order: "published_at", direction: "desc", limit } })
        .json(),

    /** Counts the unread entries: Miniflux gives the total whatever the limit. */
    getUnreadCount: async () =>
      (await client.get<MinifluxEntries>("entries", { searchParams: { status: "unread", limit: 1 } }).json()).total,
  };
}
