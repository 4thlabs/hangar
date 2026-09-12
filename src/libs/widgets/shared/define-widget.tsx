import type { ReactNode } from "react";
import { logger } from "#libs/logs";
import { WidgetError } from "./widget-error.tsx";
import { WidgetSkeleton } from "./widget-skeleton.tsx";

/**
 * Everything that identifies a widget, declared once.
 *
 * Without this each widget repeats its icon, title and size class three times
 * (card, skeleton, error) and re-implements the same try/catch + log + fallback.
 */
export type WidgetDefinition<T> = {
  /** Stable key, also used for the React key in the dashboard grid. */
  id: string;
  /** Display name, shown in the header, skeleton and error state. */
  title: string;
  icon: ReactNode;
  /** Size/layout classes for the card. */
  className?: string | undefined;
  /** Shown in the error state, after "<title> is unavailable". */
  errorDescription: string;
  /** Fetches the data. Anything thrown here becomes the error state. */
  load: () => Promise<T>;
  /** Renders the loaded data. Return null to fall back to the error state. */
  render: (data: T) => ReactNode;
  skeleton?: { withFooter?: boolean; withSubtitle?: boolean } | undefined;
};

export type Widget = {
  id: string;
  Widget: () => ReactNode | Promise<ReactNode>;
  Skeleton: () => ReactNode;
};

/**
 * Wraps a data-backed widget: one try/catch, one log, one error fallback.
 * A failing widget degrades to its own card; the rest of the dashboard stands.
 */
export function defineWidget<T>(definition: WidgetDefinition<T>): Widget {
  const { id, title, icon, className, errorDescription, load, render, skeleton } = definition;

  const fallback = () => <WidgetError className={className} icon={icon} name={title} description={errorDescription} />;

  return {
    id,
    async Widget() {
      try {
        const data = await load();
        return render(data) ?? fallback();
      } catch (error: unknown) {
        logger.error({ error, widget: id }, `Failed to load the ${title} widget`);
        return fallback();
      }
    },
    Skeleton: () => (
      <WidgetSkeleton
        className={className}
        icon={icon}
        title={title}
        withFooter={skeleton?.withFooter ?? false}
        withSubtitle={skeleton?.withSubtitle ?? false}
      />
    ),
  };
}
