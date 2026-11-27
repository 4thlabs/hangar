import { getWidgetsDataQueryOptions, getWidgetsPlacementsQueryOptions } from "#libs/api";

/** The reads of the dashboard. */
export const widgetsQueries = {
  /** The widgets `hangar.yml` places, in their columns. */
  placements: () => getWidgetsPlacementsQueryOptions(),
  /**
   * What the widget placed as `key` loaded. Not asked again on a failure: the server has tried its service twice
   * already, and keeps the last answer for 15 minutes; the card shows its error at once rather than seconds later.
   */
  data: (key: string) => getWidgetsDataQueryOptions(key, { query: { retry: false } }),
};
