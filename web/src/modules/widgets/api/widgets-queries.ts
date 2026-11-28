import { getWidgetsPlacementsQueryOptions } from "#libs/api";

/** The reads of the dashboard. */
export const widgetsQueries = {
  /** The widgets `hangar.yml` places, in their columns. */
  placements: () => getWidgetsPlacementsQueryOptions(),
};
