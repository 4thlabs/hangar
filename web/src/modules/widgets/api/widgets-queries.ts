import { queryOptions } from "@tanstack/react-query";
import { getWidgetsDataQueryKey, getWidgetsPlacementsQueryOptions, widgetsData } from "#libs/api";

/** The reads of the dashboard. */
export const widgetsQueries = {
  /** The widgets `hangar.yml` places, in their columns. */
  placements: () => getWidgetsPlacementsQueryOptions(),
  /**
   * What the widget placed as `key` loaded, read in its region. Not asked again on a failure: the server has tried its
   * service twice already, and keeps the last answer for 15 minutes; the card shows its error at once rather than
   * seconds later. Built on orval's key and fetcher, as orval's options type their function as possibly `skipToken`,
   * which a suspense query refuses under `exactOptionalPropertyTypes`.
   */
  data: (key: string) =>
    queryOptions({
      queryKey: getWidgetsDataQueryKey(key),
      queryFn: ({ signal }) => widgetsData(key, { signal }),
      retry: false,
    }),
};
