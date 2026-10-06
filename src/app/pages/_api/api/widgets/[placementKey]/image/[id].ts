import type { ApiContext } from "waku/router";
import { apiRoute, apiError } from "#app/api/api-route.ts";
import { widgetImages } from "#modules/widgets/server/server.ts";

/** A poster or a thumbnail never changes; a day of browser cache saves the service the repeat. */
const CACHE = "private, max-age=86400";

/** Relays a widget image: keeps API keys out of the HTML and gets past OIDC. */
export const GET = apiRoute<ApiContext<"/api/widgets/[placementKey]/image/[id]">>(
  { log: "Failed to proxy a widget image", unavailable: "Les images des widgets sont indisponibles." },
  async (_request, { params }) => {
    const image = await widgetImages.fetch(params.placementKey, params.id);

    // No such placement, a widget that relays nothing, or an id no service would issue.
    if (!image) {
      return apiError("Aucune image à relayer pour ce widget.", 404);
    }

    return new Response(image.body, {
      headers: { "Cache-Control": CACHE, "Content-Type": image.headers.get("content-type") ?? "image/jpeg" },
    });
  },
);
