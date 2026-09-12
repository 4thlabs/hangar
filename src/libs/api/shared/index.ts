import ky from "ky";
import { env } from "#libs/env";

type ServiceClientOptions = {
  /** Subdomain used to derive the default base URL, e.g. "arcane" -> https://arcane.<DOMAIN> */
  service: string;
  /** Explicit base URL; overrides the derived one. */
  baseUrl?: string | undefined;
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
 * Every service sits behind the same reverse proxy under `<service>.<DOMAIN>`
 * and exposes its API under `/api`, so that shape belongs here rather than
 * being re-derived per service.
 */
export function createServiceClient({ service, baseUrl, apiKey, timeout, retry = 1 }: ServiceClientOptions) {
  const url = baseUrl ?? `https://${service}.${env.DOMAIN}`;

  return {
    url,
    client: ky.extend({
      baseUrl: url,
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
    }),
  };
}
