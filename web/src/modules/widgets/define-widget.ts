import type { ComponentType } from "react";
import type { WidgetPlacement, WidgetType } from "#libs/api";
import type { WidgetLooks } from "#modules/widgets/helpers/widget-appearance.ts";

/** What a widget's card is given: its placement, whose key its reads and images go by, and whose link it opens. */
export type WidgetProps = { placement: WidgetPlacement };

/**
 * What the dashboard knows of a widget of `Type`: its icon, its size and its words, which its skeleton and its error
 * state show too, and its card, which reads what it shows.
 */
export type WidgetEntry<Type extends WidgetType> = WidgetLooks & {
  readonly type: Type;
  readonly card: ComponentType<WidgetProps>;
};

/**
 * The entry of the widget of `type`, written in its card's file and listed in `widgets-registry.ts`: the type it is
 * given is the key the registry takes it under, so that an entry listed under another is a type error there.
 */
export function defineWidget<Type extends WidgetType>(
  type: Type,
  entry: Omit<WidgetEntry<Type>, "type">,
): WidgetEntry<Type> {
  return { type, ...entry };
}
