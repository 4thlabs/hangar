import type { WidgetConfig } from "../config/config.ts";

/**
 * A widget image as the browser addresses it.
 *
 * A service's images are not something a browser can always fetch itself: the key would end up in
 * the page (Jellyfin), or the public host answers an `<img>` with a login redirect (Frigate). One
 * route serves them all — `WidgetImages` in `#modules/widgets/server/server.ts` says which widget relays what.
 */
export class WidgetImage {
  /**
   * Where a card points an `<img>` whose bytes Hangar relays.
   * @param widget The widget the image belongs to, as `hangar.yml` names it
   * @param id The image's id, as the service spells it
   */
  static url(widget: WidgetConfig["type"], id: string) {
    return `/api/widgets/${widget}/image/${encodeURIComponent(id)}`;
  }
}
