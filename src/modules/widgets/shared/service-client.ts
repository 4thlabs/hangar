import ky, { type KyInstance } from "ky";
import type { WidgetService } from "../config/config.ts";

export type ServiceClientOptions = {
  /** The header the key goes in. `X-API-Key` for most; Jellyfin wants `Authorization`. */
  apiKeyHeader?: string;
  /** Where the service roots its API. `/api` for most; gluetun versions its own, `/v1`. */
  prefix?: string;
};

/** Base for service clients: a ky instance bound to the API and key. Each subclass's `connect` opens one. */
export abstract class ServiceClient {
  /** What a self-hosted API answers on, unless a client says otherwise. */
  private static readonly Defaults = { apiKeyHeader: "X-API-Key", prefix: "/api" };

  /** One retry absorbs a dropped connection without stalling the widget behind a dead service. */
  private static readonly RetryLimit = 1;

  /** The ky client, bound to the service's address and key. */
  protected readonly http: KyInstance;

  protected constructor(http: KyInstance) {
    this.http = http;
  }

  /**
   * The ky client for a widget's service; no key, no header. Async: the key is read from disk inside the widget's
   * boundary.
   */
  protected static async client(
    { api, apiKey }: Pick<WidgetService, "api" | "apiKey">,
    options: ServiceClientOptions = {},
  ): Promise<KyInstance> {
    const { apiKeyHeader, prefix } = { ...ServiceClient.Defaults, ...options };
    const key = await apiKey();

    return ky.extend({
      baseUrl: api,
      prefix,
      retry: { limit: ServiceClient.RetryLimit },
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
