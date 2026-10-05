import { WidgetService, type WidgetConfig, type WidgetHost } from "../config/config.ts";
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

  /** The declaration a placement key names, `undefined` when the store places nothing under it. */
  private readonly placed: (key: string) => WidgetConfig | undefined;

  /** How this Hangar addresses the services its widgets read. */
  private readonly host: WidgetHost;

  /**
   * @param placed The declaration a placement key names, `undefined` when the store places nothing under it
   * @param host How this Hangar addresses the services its widgets read
   */
  constructor(placed: (key: string) => WidgetConfig | undefined, host: WidgetHost) {
    this.placed = placed;
    this.host = host;
  }

  /**
   * One relayed widget image, fetched where Hangar can reach it.
   *
   * `undefined` for anything the dashboard would never ask for — a key the store does not place,
   * a widget that relays nothing, an id no service would issue — which the route answers with a 404.
   * @param widget The placement the image belongs to, by its key: the image comes from that
   * placement's service, not the first of its type
   * @param id The image's id, as the service spells it
   */
  async fetch(widget: string, id: string): Promise<Response | undefined> {
    if (!WidgetImages.Id.test(id)) return undefined;

    const config = this.placed(widget);
    const relay = config && WidgetImages.Relays[config.type];

    return relay && (await relay(WidgetService.of(config, this.host), id));
  }
}
