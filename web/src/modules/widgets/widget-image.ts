/**
 * Where a card points an `<img>`, by its placement's key: two placements of one type may read two services. The server
 * relays the image: fetched from the service, its key would end up in the page (Jellyfin's), or the `<img>` would meet a
 * sign-in redirect (Frigate's).
 */
export function widgetImageUrl(placementKey: string, id: string) {
  return `/api/widgets/${encodeURIComponent(placementKey)}/image/${encodeURIComponent(id)}`;
}
