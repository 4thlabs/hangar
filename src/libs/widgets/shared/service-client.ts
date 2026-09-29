import ky, { type KyInstance } from "ky";
import type { WidgetService } from "../config/config.ts";

export type ServiceClientOptions = {
  /** The header the key goes in. `X-API-Key` for most; Jellyfin wants `Authorization`. */
  apiKeyHeader?: string;
  /** Where the service roots its API. `/api` for most; gluetun versions its own, `/v1`. */
  prefix?: string;
  /** Request timeout in ms. ky's own default (10s) when omitted. */
  timeout?: number;
  /** Retry attempts. */
  retry?: number;
};

/**
 * A client for a self-hosted service: the ky instance it talks through, and what each service
 * adds on top of it.
 *
 * Takes the service rather than a base URL it derives itself: a service is reached on its
 * container network and linked to on its public host, and those are two different addresses.
 * `WidgetService` owns that distinction; this only carries the shape a self-hosted API answers on.
 */
export abstract class ServiceClient {
  /** What a self-hosted API answers on, unless a client says otherwise. */
  private static readonly Defaults = { apiKeyHeader: "X-API-Key", prefix: "/api", retry: 1 };

  /** The ky client, bound to the service's address and key. */
  protected readonly http: KyInstance;

  /**
   * @param http The ky client, as {@link ServiceClient.client} builds it
   */
  protected constructor(http: KyInstance) {
    this.http = http;
  }

  /**
   * The ky client for a widget's service: base URL from `hangar.yml`, key from `.env.global`.
   *
   * An absent key is a service that takes none — no header is sent. Async because the key is read
   * from disk, and read here rather than at placement so it stays inside the widget's own Suspense
   * boundary instead of blocking the grid.
   */
  protected static async client(
    { api, apiKey }: Pick<WidgetService, "api" | "apiKey">,
    options: ServiceClientOptions = {},
  ): Promise<KyInstance> {
    const { apiKeyHeader, prefix, retry, timeout } = { ...ServiceClient.Defaults, ...options };
    const key = await apiKey();

    return ky.extend({
      baseUrl: api,
      prefix,
      retry: { limit: retry },
      ...(timeout === undefined ? {} : { timeout }),
      ...(key === undefined
        ? {}
        : {
            hooks: {
              beforeRequest: [
                ({ request }: { request: Request }) => {
                  request.headers.set(apiKeyHeader, key);
                },
              ],
            },
          }),
    });
  }
}
