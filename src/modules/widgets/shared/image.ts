/**
 * A widget image as the browser addresses it, relayed by `WidgetImages`: fetched directly, the key would end up in
 * the page (Jellyfin) or the `<img>` would get an OIDC login redirect (Frigate).
 */
export class WidgetImage {
  /** Where a card points an `<img>`, by placement key: two placements of one type may read different servers. */
  static url(placementKey: string, id: string) {
    return `/api/widgets/${placementKey}/image/${encodeURIComponent(id)}`;
  }
}
