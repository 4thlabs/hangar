import type { ReactNode } from "react";
import { Cache, type Snapshot } from "#libs/cache";
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
   * @param key The placement's key, for anything addressed per placement, like a relayed image
   */
  render: (data: T, key: string) => ReactNode;
} & (
  | {
      /** Fetches the data. Anything thrown here becomes the error state. */
      load: () => Promise<T>;
      /** How long the loaded data stays fresh, in milliseconds. Defaults to {@link TTL}. */
      ttl?: number | undefined;
    }
  | {
      /**
       * Data some other layer already caches, and keeps fresh on its own terms — the Docker widget
       * reads the daemon's snapshots, which follow its events. Read as is: caching it again here
       * would only add a TTL for it to go stale behind.
       */
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
 * Every widget's data, cached in one place. Shared rather than per widget, because `WidgetRegistry`
 * rebuilds most widget objects on every render — a cache closed over by one `defineWidget` call
 * would be thrown away with it and cache nothing. The per-call handle below is only the bound
 * key, TTL, grace and loader; the entries it reads live here, so a rebuilt widget finds them.
 *
 * Process-global, keyed by placement (`WidgetKey` in `config.ts`), and therefore only safe while
 * no widget renders per-session data. None does; the day one needs to, it must not read through here.
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
            logger.error(`Failed to render the ${title} widget`, { error, widget: key });
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
            logger.error(`Failed to load the ${title} widget`, { error, widget: key });
            return fallback();
          }
        })();
      },
      warm: snapshot.warm,
      ready: () => snapshot.peek() !== undefined,
      Skeleton: skeleton,
    };
  };

  return at(id);
}
