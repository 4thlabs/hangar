import type { WidgetService } from "../../config/config.ts";
import { serviceClient } from "../../shared/service-client.ts";

/**
 * What Beszel's agent last reported about a host, under the single-letter keys it stores.
 *
 * Every field is optional: a system that has never checked in — or one that is paused — carries an
 * `info` with whatever the hub last saw, which may be nothing at all.
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
 * Talks to one Beszel hub, which is a PocketBase and answers under `/api/collections`.
 *
 * The key goes in `Authorization` rather than `X-API-Key`: PocketBase reads the raw token there,
 * with or without a `Bearer` prefix, so a Beszel API token works as pasted.
 */
export async function createBeszelClient(service: WidgetService) {
  const client = await serviceClient(service, { apiKeyHeader: "Authorization" });

  return {
    /** Lists the monitored hosts, newest reading included, alphabetically as the hub's own page shows them. */
    listSystems: () =>
      client
        .get<BeszelPage<BeszelSystem>>("/collections/systems/records", {
          searchParams: { sort: "name", fields: "id,name,status,info", perPage: 100 },
        })
        .json(),
  };
}
