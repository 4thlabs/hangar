import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/**
 * What Beszel's agent last reported about a host, under its single-letter keys. All optional: a host that never
 * checked in, or is paused, may carry nothing.
 */
export interface BeszelSystemInfo {
  /** Uptime, in seconds. */
  u?: number;
  /** CPU used, in percent. */
  cpu?: number;
  /** Memory used, in percent. */
  mp?: number;
  /** Root disk used, in percent. */
  dp?: number;
  /** Hottest sensor, in °C. */
  dt?: number;
  /** CPU model. */
  m?: string;
  /** Cores. */
  c?: number;
}

/** One monitored host, as the `systems` collection records it. `status` is up/down/paused/pending. */
export interface BeszelSystem {
  id: string;
  name: string;
  status: string;
  info: BeszelSystemInfo;
}

/** PocketBase pages every list, even one of four servers. */
interface BeszelPage<T> {
  items: T[];
}

/**
 * Talks to one Beszel hub (a PocketBase). The key goes in `Authorization`, where PocketBase reads a raw token, so a
 * Beszel API token works as pasted.
 */
export class BeszelClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new BeszelClient(await ServiceClient.client(service, { apiKeyHeader: "Authorization" }));
  }

  /** The monitored hosts with their latest reading, alphabetically as the hub's own page shows them. */
  listSystems() {
    return this.http
      .get<BeszelPage<BeszelSystem>>("/collections/systems/records", {
        searchParams: { sort: "name", fields: "id,name,status,info", perPage: 100 },
      })
      .json();
  }
}
