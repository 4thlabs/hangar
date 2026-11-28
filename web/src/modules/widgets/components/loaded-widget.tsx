import type { ReactNode } from "react";
import type { WidgetPlacement } from "#libs/api";
import { QueryRegion } from "#modules/common/components/region.tsx";
import type { WidgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { useWidgetData, type LoadingWidgetType, type WidgetDataOf } from "#modules/widgets/hooks/use-widget-data.ts";
import { WidgetFailure, WidgetSkeleton } from "./widget-states.tsx";

type LoadedWidgetProps<Type extends LoadingWidgetType> = {
  placement: WidgetPlacement;
  type: Type;
  look: WidgetLook;
  /** The card of what the widget loaded. */
  children: (data: WidgetDataOf<Type>) => ReactNode;
};

/**
 * A widget that loads its data, in its own region: its skeleton while the data comes, its error when its service did
 * not answer, and its card once loaded, which renders the next answer when it threw on one. Each widget waits for its
 * own: a slow service holds its card alone. A card that has data keeps it when it is read again and that fails, as when
 * the tab comes back while the server restarts: the server keeps the last answer of a service for 15 minutes, and says
 * when it is too old.
 */
export function LoadedWidget<Type extends LoadingWidgetType>({
  placement,
  type,
  look,
  children,
}: LoadedWidgetProps<Type>) {
  const data = useWidgetData(placement.key, type);

  return (
    <QueryRegion
      query={data}
      fallback={<WidgetSkeleton look={look} />}
      failure={failure => <WidgetFailure look={look} {...failure} />}
    >
      {children}
    </QueryRegion>
  );
}
