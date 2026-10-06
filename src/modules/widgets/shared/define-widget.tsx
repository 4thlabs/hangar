import type { ReactNode } from "react";
import { Cache, type Snapshot } from "#libs/cache";
import { logger } from "#libs/logs";
import { renderSnapshot } from "#modules/common/components/render-snapshot.ts";
import { WidgetError } from "./widget-error.tsx";
import { WidgetSkeleton } from "./widget-skeleton.tsx";

/**
 * Everything that identifies a widget, read by its card, skeleton and error fallback. Each widget keeps its title,
 * icon and className in one `chrome` const, so the card and the fallbacks it degrades to cannot disagree.
 */
export type WidgetDefinition<T> = {
  /** The widget type, as `hangar.yml` names it; the key of an unplaced widget. */
  id: string;
  /** Display name, shown in the header, skeleton and error state. */
  title: string;
  icon: ReactNode;
  /** Size/layout classes for the card. */
  className?: string | undefined;
  /** Shown in the error state, after "<title> is unavailable". */
  errorDescription: string;
  /**
   * Renders the loaded data. Return null to fall back to the error state.
   * @param placementKey For anything addressed per placement, like a relayed image
   */
  render: (data: T, placementKey: string) => ReactNode;
} & (
  | {
      /** Fetches the data. Anything thrown here becomes the error state. */
      load: () => Promise<T>;
      /** How long the loaded data stays fresh, in milliseconds. Defaults to {@link TTL}. */
      ttl?: number | undefined;
    }
  | {
      /** Data another layer already keeps fresh (the Docker daemon's snapshots); read as is, not cached again. */
      snapshot: Snapshot<T>;
    }
);

export type Widget = {
  /** The widget type, shared by every placement of it. */
  id: string;
  /**
   * Which placement this is: its cache entry, and its React key in the dashboard grid. The type
   * until {@link at} says otherwise.
   */
  key: string;
  /** This widget, bound to one placement's key — a copy, so a shared widget is never mutated. */
  at: (key: string) => Widget;
  Widget: () => ReactNode | Promise<ReactNode>;
  Skeleton: () => ReactNode;
  /** Loads into the snapshot ahead of a render, so the dashboard never paints a skeleton. */
  warm: () => Promise<void>;
  /** Whether {@link Widget} can render without suspending, i.e. whether it needs a boundary at all. */
  ready: () => boolean;
};

/**
 * Module-level so widgets rebuilt per render keep their entries. Process-global, keyed by placement: never put
 * per-session data here.
 */
const cache = new Cache();

/**
 * How long a widget's data is fresh, when its `hangar.yml` entry does not say. The dashboard has no
 * auto-reload, so this is what a visit sees.
 */
const TTL = 60_000;

/** How long a service that has stopped answering keeps rendering its last good card. */
const GRACE = 900_000;

/** Drops every cached widget load. Tests only, so one test's data cannot leak into the next. */
export const clearWidgetCache = () => cache.clear();

/**
 * Wraps a data-backed widget: one try/catch, one log, one error fallback.
 * A failing widget degrades to its own card; the rest of the dashboard stands.
 */
export function defineWidget<T>(definition: WidgetDefinition<T>): Widget {
  const { id, title, icon, className, errorDescription, render } = definition;

  const fallback = () => <WidgetError className={className} icon={icon} name={title} description={errorDescription} />;
  const skeleton = () => <WidgetSkeleton className={className} icon={icon} title={title} />;

  const at = (key: string): Widget => {
    const snapshot =
      "snapshot" in definition ? definition.snapshot : cache.define(key, definition.ttl ?? TTL, GRACE, definition.load);

    return {
      id,
      key,
      at,
      Widget() {
        const show = (data: T) => {
          try {
            return render(data, key) ?? fallback();
          } catch (error: unknown) {
            logger.error(`Failed to render the ${title} widget`, { error, placementKey: key });
            return fallback();
          }
        };

        return renderSnapshot(snapshot, show, (error: unknown) => {
          logger.error(`Failed to load the ${title} widget`, { error, placementKey: key });

          return fallback();
        });
      },
      warm: snapshot.warm,
      ready: () => snapshot.peek() !== undefined,
      Skeleton: skeleton,
    };
  };

  return at(id);
}
