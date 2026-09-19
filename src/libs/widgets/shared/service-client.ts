import ky from "ky";
import type { WidgetService } from "../config/config.ts";

type ServiceClientOptions = {
  /** Where the service answers, as `widgetService` resolved it from `hangar.yml`. */
  baseUrl: string;
  /** Sent as X-API-Key when present. */
  apiKey?: string | undefined;
  /** Request timeout in ms. ky's own default (10s) when omitted. */
  timeout?: number;
  /** Retry attempts. */
  retry?: number;
};

/**
 * Builds a ky client for a self-hosted service.
 *
 * Takes the base URL rather than deriving one: a service is reached on its
 * container network and linked to on its public host, and those are two
 * different addresses. `widgetService` owns that distinction; this only exposes
 * the `/api` prefix every service shares.
 */
export function createServiceClient({ baseUrl, apiKey, timeout, retry = 1 }: ServiceClientOptions) {
  return ky.extend({
    baseUrl,
    prefix: "/api",
    retry: { limit: retry },
    ...(timeout === undefined ? {} : { timeout }),
    ...(apiKey === undefined
      ? {}
      : {
          hooks: {
            beforeRequest: [
              ({ request }: { request: Request }) => {
                request.headers.set("X-API-Key", apiKey);
              },
            ],
          },
        }),
  });
}

/**
 * The ky client for a widget's service: base URL from `hangar.yml`, key from `.env.global`.
 *
 * An absent key is a service that takes none — no header is sent. Async because the key is read
 * from disk, and read here rather than at placement so it stays inside the widget's own Suspense
 * boundary instead of blocking the grid.
 */
export const serviceClient = async ({ api, apiKey }: WidgetService) =>
  createServiceClient({ baseUrl: api, apiKey: await apiKey() });
