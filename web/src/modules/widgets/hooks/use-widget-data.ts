import { useSuspenseQuery } from "@tanstack/react-query";
import type { WidgetData } from "#libs/api";
import { widgetsQueries } from "#modules/widgets/api/widgets-queries.ts";

/** The type of a widget that loads data of its own. */
export type LoadingWidgetType = WidgetData["type"];

/** What a widget of `Type` loads. */
export type WidgetDataOf<Type extends LoadingWidgetType> = Extract<WidgetData, { type: Type }>["data"];

/**
 * What the widget placed as `key`, of `type`, loaded, read in its `Region`: it suspends until the first answer, and
 * throws to the region a failure with no data. `undefined` as data for a key that now places another type, until the
 * placements are read again.
 */
export function useWidgetData<Type extends LoadingWidgetType>(key: string, type: Type) {
  // TypeScript narrows a union by a literal tag, not by a generic one: the check is written out, and the data cast.
  const select = (loaded: WidgetData) => (loaded.type === type ? (loaded.data as WidgetDataOf<Type>) : undefined);

  return useSuspenseQuery({ ...widgetsQueries.data(key), select });
}
