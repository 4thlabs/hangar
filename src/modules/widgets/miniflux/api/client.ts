import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/** The subset of a Miniflux entry displayed by Hangar. */
export interface MinifluxEntry {
  id: number;
  title: string;
  url: string;
  published_at: string;
  status: "read" | "unread" | "removed";
  feed: { title: string };
}

/** One page of entries, with the total the filter matches. */
export interface MinifluxEntries {
  total: number;
  entries: MinifluxEntry[];
}

/** Talks to one Miniflux instance. */
export class MinifluxClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new MinifluxClient(await ServiceClient.client(service, { prefix: "/v1", apiKeyHeader: "X-Auth-Token" }));
  }

  /** The newest entries, read or not. */
  getEntries(limit: number = 8) {
    return this.http
      .get<MinifluxEntries>("entries", { searchParams: { order: "published_at", direction: "desc", limit } })
      .json();
  }

  /** Counts the unread entries: Miniflux gives the total whatever the limit. */
  async getUnreadCount() {
    return (await this.http.get<MinifluxEntries>("entries", { searchParams: { status: "unread", limit: 1 } }).json())
      .total;
  }
}
