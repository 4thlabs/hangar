import type { ApiContext } from "waku/router";
import { apiRoute, apiError } from "#app/api/api-route.ts";
import { createJellyfinClient } from "#libs/widgets/jellyfin/api";
import { serviceFor } from "#libs/widgets/server";

/** Posters do not change; a day of browser cache saves Jellyfin the repeat. */
const CACHE = "private, max-age=86400";

/**
 * Relays one library item's poster.
 *
 * The point is the key: a Jellyfin poster URL authenticates with `api_key` in the query string,
 * so pointing an `<img>` straight at Jellyfin would print the key into the dashboard's HTML for
 * anyone who can load the page. Fetching it here keeps the key on the server, and `apiRoute`
 * already turns an anonymous request away before any of this runs.
 */
export const GET = apiRoute<ApiContext<"/api/jellyfin/poster/[item]">>(
  { log: "Failed to proxy a Jellyfin poster", unavailable: "Les affiches Jellyfin sont indisponibles." },
  async (_request, { params }) => {
    const service = serviceFor("jellyfin-latest");

    // Nothing to proxy for: the store places no Jellyfin widget, so there is no server to ask.
    if (!service) return apiError("Aucun widget Jellyfin n’est configuré.", 404);

    const poster = await (await createJellyfinClient(service)).getPoster(params.item);

    return new Response(poster.body, {
      headers: {
        "Cache-Control": CACHE,
        "Content-Type": poster.headers.get("content-type") ?? "image/jpeg",
      },
    });
  },
);
