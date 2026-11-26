import type { ReactNode } from "react";
import type { WidgetPlacement } from "#libs/api";
import { Region } from "#modules/common/components/region.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { widgetLook, type WidgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { useWidgetData, type LoadingWidgetType, type WidgetDataOf } from "#modules/widgets/hooks/use-widget-data.ts";
import { WidgetCardFailure, WidgetError, WidgetSkeleton } from "./widget-states.tsx";

type LoadedWidgetProps<Type extends LoadingWidgetType> = {
  placement: WidgetPlacement;
  type: Type;
  /** The card of what the widget loaded. */
  children: (data: WidgetDataOf<Type>) => ReactNode;
};

/**
 * A widget that loads its data, in its own region: its skeleton while the data comes, its error when its service did
 * not answer, and its card once loaded. Each widget waits for its own: a slow service holds its card alone. A card that
 * has data keeps it when it is read again and that fails, as when the tab comes back while the server restarts: the
 * server keeps the last answer of a service for 15 minutes, and says when it is too old.
 */
export function LoadedWidget<Type extends LoadingWidgetType>({ placement, type, children }: LoadedWidgetProps<Type>) {
  const look = widgetLook(type);

  return (
    <Region
      fallback={<WidgetSkeleton look={look} />}
      failure={({ error, retry }) => <WidgetError look={look} reason={describeError(error)} retry={retry} />}
    >
      <LoadedCard placementKey={placement.key} type={type} look={look}>
        {children}
      </LoadedCard>
    </Region>
  );
}

type LoadedCardProps<Type extends LoadingWidgetType> = Omit<LoadedWidgetProps<Type>, "placement"> & {
  placementKey: string;
  look: WidgetLook;
};

/** The card of what the widget loaded, in a region of its own: a card that threw on one answer renders the next. */
function LoadedCard<Type extends LoadingWidgetType>({ placementKey, type, look, children }: LoadedCardProps<Type>) {
  const { data, dataUpdatedAt } = useWidgetData(placementKey, type);

  if (data === undefined) {
    return <WidgetSkeleton look={look} />;
  }

  return (
    <Region resetKey={dataUpdatedAt} failure={({ retry }) => <WidgetCardFailure look={look} retry={retry} />}>
      {children(data)}
    </Region>
  );
}
