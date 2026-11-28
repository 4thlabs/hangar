import { getServicesJellyfinQueryOptions, type ServicesJellyfinParams } from "#libs/api";

/**
 * The reads of the services the widgets show, one per service: each takes the placement's key and the read of its card,
 * the parts it shows, which `useServiceRead` gives back. Not asked again on a failure: the server has tried its service
 * twice already, and keeps the last answer for 15 minutes; the card shows its error at once rather than seconds later.
 */
export const servicesQueries = {
  jellyfin: (widget: string, read: ServicesJellyfinParams) =>
    getServicesJellyfinQueryOptions(widget, read, { query: { retry: false } }),
};
