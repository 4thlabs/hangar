import type { WidgetConfig, WidgetService } from "../config/config.ts";
import { FrigateClient } from "../frigate/api/index.ts";
import { JellyfinClient } from "../jellyfin/api/index.ts";

/**
 * Relays the images a widget shows but a browser cannot fetch itself.
 */
export class WidgetImages {
  /**
   * The widgets that relay images, and the call that fetches one.
   *
   * Adding one is a line here plus the fetch on that service's client — the route, the session
   * check and the caching are already written.
   */
  private static readonly Relays: Partial<
    Record<WidgetConfig["type"], (service: WidgetService, id: string) => Promise<Response>>
  > = {
    "frigate-events": async (service, id) => (await FrigateClient.connect(service)).getThumbnail(id),
    "jellyfin-latest": async (service, id) => (await JellyfinClient.connect(service)).getPoster(id),
  };

  /**
   * Ids as the services spell them: a Jellyfin uuid, or Frigate's `<timestamp>-<label>`.
   *
   * The id lands in the upstream path, so it is checked rather than escaped: anything else is
   * someone trying to steer the request, and a widget relay is not a general-purpose proxy.
   */
  private static readonly Id = /^[\w.-]+$/;

  /** The service a placed widget talks to, `undefined` when the store does not place it. */
  private readonly serviceFor: (type: WidgetConfig["type"]) => WidgetService | undefined;

  /**
   * @param serviceFor The service a placed widget talks to, `undefined` when the store does not place it
   */
  constructor(serviceFor: (type: WidgetConfig["type"]) => WidgetService | undefined) {
    this.serviceFor = serviceFor;
  }

  /**
   * One relayed widget image, fetched where Hangar can reach it.
   *
   * `undefined` for anything the dashboard would never ask for — a widget that relays nothing, one
   * the store does not place, an id no service would issue — which the route answers with a 404.
   * @param widget The widget the image belongs to, as `hangar.yml` names it
   * @param id The image's id, as the service spells it
   */
  async fetch(widget: string, id: string): Promise<Response | undefined> {
    const relay = WidgetImages.Relays[widget as WidgetConfig["type"]];

    if (!relay || !WidgetImages.Id.test(id)) return undefined;

    const service = this.serviceFor(widget as WidgetConfig["type"]);

    return service && (await relay(service, id));
  }
}
