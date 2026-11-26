import type { ReactNode } from "react";
import type { WidgetPlacement } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { useWidgetData, type LoadingWidgetType, type WidgetDataOf } from "#modules/widgets/hooks/use-widget-data.ts";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { WidgetError, WidgetSkeleton } from "./widget-states.tsx";

type LoadedWidgetProps<Type extends LoadingWidgetType> = {
  placement: WidgetPlacement;
  type: Type;
  /** The card of what the widget loaded. */
  children: (data: WidgetDataOf<Type>) => ReactNode;
};

/**
 * A widget that loads its data: its skeleton while the data comes, its error when its service did not answer, and its
 * card once loaded. Each widget waits for its own: a slow service holds its card alone. A card that has data keeps it
 * when it is read again and that fails, as when the tab comes back while the server restarts: the server keeps the
 * last answer of a service for 15 minutes, and says when it is too old.
 */
export function LoadedWidget<Type extends LoadingWidgetType>({ placement, type, children }: LoadedWidgetProps<Type>) {
  const look = WidgetAppearance.get(type);
  const { data, error } = useWidgetData(placement.key, type);

  if (data !== undefined) {
    return children(data);
  }

  if (error) {
    return <WidgetError look={look} reason={ErrorMessage.describe(error)} />;
  }

  return <WidgetSkeleton look={look} />;
}
