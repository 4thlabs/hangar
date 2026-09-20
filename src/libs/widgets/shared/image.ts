import type { WidgetConfig } from "../config/config.ts";

/**
 * Where a card points an `<img>` whose bytes Hangar relays.
 *
 * A service's images are not something a browser can always fetch itself: the key would end up in
 * the page (Jellyfin), or the public host answers an `<img>` with a login redirect (Frigate). One
 * route serves them all — `widgetImage` in `#libs/widgets/server` says which widget relays what.
 * @param widget The widget the image belongs to, as `hangar.yml` names it
 * @param id The image's id, as the service spells it
 */
export const widgetImageUrl = (widget: WidgetConfig["type"], id: string) =>
  `/api/widgets/${widget}/image/${encodeURIComponent(id)}`;
