import type { ReactNode } from "react";
import { Snapshots } from "#libs/cache";
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
  /** Loads into the snapshot ahead of a render, so the dashboard never paints a skeleton. */
  warm: () => Promise<void>;
  /** Whether {@link Widget} can render without suspending, i.e. whether it needs a boundary at all. */
  ready: () => boolean;
};

/**
 * Every widget's data, cached in one place. Shared rather than per widget, because `resolveWidgets`
 * rebuilds most widget objects on every render — a cache closed over by one `defineWidget` call
 * would be thrown away with it and cache nothing. The per-call handle below is only the bound
 * key, TTL, grace and loader; the entries it reads live here, so a rebuilt widget finds them.
 *
 * Process-global, keyed by widget id, and therefore only safe while no widget renders per-session
 * data. None does; the day one needs to, it must not read through here.
 *
 * ponytail: a widget id is not unique — `hangar.yml` accepts two `github-releases` blocks with
 * different repositories, and both would read one entry. Give `WidgetDefinition` an optional
 * `cacheKey` defaulting to `id`, set to `${id}:${service.api}` by the service factories, when that
 * happens. Do not uniquify `widget.id` in `resolveWidgets` instead: the clock and Docker widgets
 * are shared module singletons, so assigning to `.id` would corrupt them for every later render.
 */
const snapshots = new Snapshots();

/** How long a widget's data is fresh. The dashboard has no auto-reload, so this is what a visit sees. */
const TTL = 60_000;

/** How long a service that has stopped answering keeps rendering its last good card. */
const GRACE = 900_000;

/** Drops every cached widget load. Tests only, so one test's data cannot leak into the next. */
export const clearWidgetCache = () => snapshots.clear();

/**
 * Wraps a data-backed widget: one try/catch, one log, one error fallback.
 * A failing widget degrades to its own card; the rest of the dashboard stands.
 */
export function defineWidget<T>(definition: WidgetDefinition<T>): Widget {
  const { id, title, icon, className, errorDescription, load, render, skeleton } = definition;

  const fallback = () => <WidgetError className={className} icon={icon} name={title} description={errorDescription} />;
  const snapshot = snapshots.define(id, TTL, GRACE, load);

  return {
    id,
    Widget() {
      const show = (data: T) => {
        try {
          return render(data) ?? fallback();
        } catch (error: unknown) {
          logger.error(`Failed to render the ${title} widget`, { error, widget: id });
          return fallback();
        }
      };

      // Synchronously, when the snapshot is warm. An async component suspends, and a suspended
      // boundary puts its skeleton in the shell no matter how fast the data arrives — so this,
      // not the cache alone, is what keeps the dashboard from painting skeletons at all.
      const ready = snapshot.peek();

      if (ready) return show(ready.data);

      return (async () => {
        try {
          return show(await snapshot.read());
        } catch (error: unknown) {
          logger.error(`Failed to load the ${title} widget`, { error, widget: id });
          return fallback();
        }
      })();
    },
    warm: snapshot.warm,
    ready: () => snapshot.peek() !== undefined,
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
