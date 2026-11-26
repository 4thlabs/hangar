import { useWidgetsData, type WidgetData } from "#libs/api";

/** The type of a widget that loads data of its own. */
export type LoadingWidgetType = WidgetData["type"];

/** What a widget of `Type` loads. */
export type WidgetDataOf<Type extends LoadingWidgetType> = Extract<WidgetData, { type: Type }>["data"];

/**
 * What the widget placed as `key`, of `type`, loaded. Not asked again on a failure: the server has tried its service
 * twice already, and keeps the last answer for 15 minutes; the card shows its error at once rather than seconds later.
 * `undefined` as data for a key that now places another type, until the placements are read again.
 */
export function useWidgetData<Type extends LoadingWidgetType>(key: string, type: Type) {
  // TypeScript narrows a union by a literal tag, not by a generic one: the check is written out, and the data cast.
  const select = (loaded: WidgetData) => (loaded.type === type ? (loaded.data as WidgetDataOf<Type>) : undefined);

  return useWidgetsData<WidgetDataOf<Type> | undefined>(key, { query: { retry: false, select } });
}
