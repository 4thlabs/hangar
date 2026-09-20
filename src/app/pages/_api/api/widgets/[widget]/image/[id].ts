import type { ApiContext } from "waku/router";
import { apiRoute, apiError } from "#app/api/api-route.ts";
import { widgetImage } from "#libs/widgets/server";

/** A poster or a thumbnail never changes; a day of browser cache saves the service the repeat. */
const CACHE = "private, max-age=86400";

/**
 * Relays one widget's image.
 *
 * The point is what the browser cannot do itself: fetching a Jellyfin poster straight from the
 * source would print the API key into the dashboard's HTML, and a Frigate thumbnail sits behind
 * the OIDC middleware, which answers an `<img>` with a login redirect. Hangar fetches both on the
 * container network instead, and `apiRoute` turns an anonymous request away before any of it runs.
 */
export const GET = apiRoute<ApiContext<"/api/widgets/[widget]/image/[id]">>(
  { log: "Failed to proxy a widget image", unavailable: "Les images des widgets sont indisponibles." },
  async (_request, { params }) => {
    const image = await widgetImage(params.widget, params.id);

    // No relay, no such widget placed, or an id no service would issue.
    if (!image) return apiError("Aucune image à relayer pour ce widget.", 404);

    return new Response(image.body, {
      headers: { "Cache-Control": CACHE, "Content-Type": image.headers.get("content-type") ?? "image/jpeg" },
    });
  },
);
