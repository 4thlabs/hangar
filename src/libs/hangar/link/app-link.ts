/**
 * Where Traefik serves a store app's container. No dependency, so the widget registry can import it without
 * dragging the store into the RSC graph.
 */
export class AppLink {
  static url(containerName: string, domain: string) {
    return `https://${containerName}.${domain}`;
  }
}
