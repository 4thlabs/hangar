import {
  getServicesArcaneQueryOptions,
  getServicesBackrestQueryOptions,
  getServicesBeszelQueryOptions,
  getServicesFinnhubQueryOptions,
  getServicesForgejoQueryOptions,
  getServicesFrigateQueryOptions,
  getServicesGithubQueryOptions,
  getServicesGluetunQueryOptions,
  getServicesJellyfinQueryOptions,
  getServicesMinifluxQueryOptions,
  getServicesTcgCollectorQueryOptions,
  type ServicesArcaneParams,
  type ServicesBackrestParams,
  type ServicesBeszelParams,
  type ServicesFinnhubParams,
  type ServicesForgejoParams,
  type ServicesFrigateParams,
  type ServicesGithubParams,
  type ServicesGluetunParams,
  type ServicesJellyfinParams,
  type ServicesMinifluxParams,
  type ServicesTcgCollectorParams,
} from "#libs/api";

/**
 * The reads of the services the widgets show, one per service: each takes the placement's key and the read of its card,
 * the parts it shows, which `useServiceRead` gives back. Not asked again on a failure: the server has tried its service
 * twice already, and serves the last answer 15 minutes past the widget's `ttl`. A card with no answer yet shows its
 * error at once rather than seconds later; one that has data keeps it, as its `QueryRegion` does.
 */
export const servicesQueries = {
  arcane: (widget: string, read: ServicesArcaneParams) =>
    getServicesArcaneQueryOptions(widget, read, { query: { retry: false } }),
  backrest: (widget: string, read: ServicesBackrestParams) =>
    getServicesBackrestQueryOptions(widget, read, { query: { retry: false } }),
  beszel: (widget: string, read: ServicesBeszelParams) =>
    getServicesBeszelQueryOptions(widget, read, { query: { retry: false } }),
  finnhub: (widget: string, read: ServicesFinnhubParams) =>
    getServicesFinnhubQueryOptions(widget, read, { query: { retry: false } }),
  forgejo: (widget: string, read: ServicesForgejoParams) =>
    getServicesForgejoQueryOptions(widget, read, { query: { retry: false } }),
  frigate: (widget: string, read: ServicesFrigateParams) =>
    getServicesFrigateQueryOptions(widget, read, { query: { retry: false } }),
  github: (widget: string, read: ServicesGithubParams) =>
    getServicesGithubQueryOptions(widget, read, { query: { retry: false } }),
  gluetun: (widget: string, read: ServicesGluetunParams) =>
    getServicesGluetunQueryOptions(widget, read, { query: { retry: false } }),
  jellyfin: (widget: string, read: ServicesJellyfinParams) =>
    getServicesJellyfinQueryOptions(widget, read, { query: { retry: false } }),
  miniflux: (widget: string, read: ServicesMinifluxParams) =>
    getServicesMinifluxQueryOptions(widget, read, { query: { retry: false } }),
  tcgCollector: (widget: string, read: ServicesTcgCollectorParams) =>
    getServicesTcgCollectorQueryOptions(widget, read, { query: { retry: false } }),
};
