/**
 * Where a card points an `<img>`: the server's relay, by the placement's key, which names the service, and the image's
 * id as the server wrote it in a part (`poster.6c1e2f0a9b`), passed as it is. Fetched from the service, its key would
 * end up in the page (Jellyfin's), or the `<img>` would meet a sign-in redirect (Frigate's).
 */
export function widgetImageUrl(placementKey: string, imageId: string) {
  return `/api/services/images/${encodeURIComponent(placementKey)}/${encodeURIComponent(imageId)}`;
}
