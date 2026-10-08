import { WidgetService, type WidgetHost } from "../config/config.ts";
import { WidgetDescriptors, type WidgetConfig } from "../config/widgets.ts";

/** Relays the images a widget shows but a browser cannot fetch itself. */
export class WidgetImages {
  /**
   * Ids as the services spell them: a Jellyfin uuid, or Frigate's `<timestamp>-<label>`. Checked rather than escaped:
   * the id lands in the upstream path, and the relay is not a general-purpose proxy.
   */
  private static readonly Id = /^[\w.-]+$/;

  /** The declaration a placement key names, `undefined` when the store places nothing under it. */
  private readonly placed: (key: string) => WidgetConfig | undefined;

  /** How this Hangar addresses the services its widgets read. */
  private readonly host: WidgetHost;

  constructor(placed: (key: string) => WidgetConfig | undefined, host: WidgetHost) {
    this.placed = placed;
    this.host = host;
  }

  /**
   * One image, fetched from the service of the placement `placementKey` names. `undefined` (a 404) for an unplaced key, a
   * widget that relays nothing, or an id no service would issue.
   */
  async fetch(placementKey: string, id: string): Promise<Response | undefined> {
    if (!WidgetImages.Id.test(id)) {
      return undefined;
    }

    const config = this.placed(placementKey);

    if (!config) {
      return undefined;
    }

    const descriptor = WidgetDescriptors.get(config.type);

    return descriptor.relay?.(WidgetService.resolve(config, descriptor, this.host), id);
  }
}
