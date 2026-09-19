import ky from "ky";
import type { WidgetService } from "../config/config.ts";

export type ServiceClientOptions = {
  /** Where the service answers, as `widgetService` resolved it from `hangar.yml`. */
  baseUrl: string;
  /** Sent as X-API-Key when present. */
  apiKey?: string | undefined;
  /** Where the service roots its API. `/api` for most; gluetun versions its own, `/v1`. */
  prefix?: string;
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
 * different addresses. `widgetService` owns that distinction; this only carries
 * the shape a self-hosted API answers on.
 */
export function createServiceClient({ baseUrl, apiKey, prefix = "/api", timeout, retry = 1 }: ServiceClientOptions) {
  return ky.extend({
    baseUrl,
    prefix,
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
export const serviceClient = async (
  { api, apiKey }: WidgetService,
  options: Omit<ServiceClientOptions, "baseUrl" | "apiKey"> = {},
) => createServiceClient({ ...options, baseUrl: api, apiKey: await apiKey() });
