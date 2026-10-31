import type { ApiContext } from "waku/router";
import { ServerTranslation } from "#libs/i18n/server";
import { apiError, apiRoute } from "#app/api/api-route.ts";
import { ApiMessages } from "#app/api/messages.ts";
import { widgetImages } from "#modules/widgets/server/server.ts";

/** A poster or a thumbnail never changes; a day of browser cache saves the service the repeat. */
const CACHE = "private, max-age=86400";

/** Relays a widget image: keeps API keys out of the HTML and gets past OIDC. */
export const GET = apiRoute<ApiContext<"/api/widgets/[placementKey]/image/[id]">>(
  { log: "Failed to proxy a widget image", unavailable: "widgetImages" },
  async (_request, { params }) => {
    const image = await widgetImages.fetch(params.placementKey, params.id);

    // No such placement, a widget that relays nothing, an id no service would issue, or an image the service lacks.
    if (!image) {
      return apiError(ServerTranslation.get(ApiMessages).t("noWidgetImage"), 404);
    }

    return new Response(image.body, {
      headers: { "Cache-Control": CACHE, "Content-Type": image.headers.get("content-type") ?? "image/jpeg" },
    });
  },
);
