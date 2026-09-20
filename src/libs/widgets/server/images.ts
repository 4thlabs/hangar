import type { WidgetConfig, WidgetService } from "../config/config.ts";
import { createFrigateClient } from "../frigate/api/index.ts";
import { createJellyfinClient } from "../jellyfin/api/index.ts";
import { serviceFor } from "./server.ts";

/**
 * The widgets that relay images, and the call that fetches one.
 *
 * Adding one is a line here plus the fetch on that service's client — the route, the session
 * check and the caching are already written.
 */
const relays: Partial<Record<WidgetConfig["type"], (service: WidgetService, id: string) => Promise<Response>>> = {
  "frigate-events": async (service, id) => (await createFrigateClient(service)).getThumbnail(id),
  "jellyfin-latest": async (service, id) => (await createJellyfinClient(service)).getPoster(id),
};

/**
 * Ids as the services spell them: a Jellyfin uuid, or Frigate's `<timestamp>-<label>`.
 *
 * The id lands in the upstream path, so it is checked rather than escaped: anything else is
 * someone trying to steer the request, and a widget relay is not a general-purpose proxy.
 */
const ID = /^[\w.-]+$/;

/**
 * One relayed widget image, fetched where Hangar can reach it.
 *
 * `undefined` for anything the dashboard would never ask for — a widget that relays nothing, one
 * the store does not place, an id no service would issue — which the route answers with a 404.
 * @param widget The widget the image belongs to, as `hangar.yml` names it
 * @param id The image's id, as the service spells it
 */
export async function widgetImage(widget: string, id: string): Promise<Response | undefined> {
  const relay = relays[widget as WidgetConfig["type"]];

  if (!relay || !ID.test(id)) return undefined;

  const service = serviceFor(widget as WidgetConfig["type"]);

  return service && (await relay(service, id));
}
