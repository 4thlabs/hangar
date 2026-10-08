import type { ReactNode } from "react";
import { chain, fulfilled, map, recover } from "#libs/cache";
import { cache } from "#libs/cache/server";
import { logger } from "#libs/logs";
import type { WidgetAppearance } from "../config/config.ts";
import { WidgetError } from "./widget-error.tsx";
import { WidgetSkeleton } from "./widget-skeleton.tsx";

/** What a widget's module contributes: where its data comes from, and how it looks once loaded. */
export type WidgetBody<T = unknown> = {
  /**
   * Renders the loaded data. Return null to fall back to the error state. A method, so any body fits `WidgetBody`.
   * @param placementKey For anything addressed per placement, like a relayed image
   */
  render(data: T, placementKey: string): ReactNode;
} & (
  | {
      /** Fetches the data. Anything thrown here becomes the error state. */
      load: () => Promise<T>;
    }
  | {
      /** Data another layer already caches and keeps fresh (the Docker daemon's); read as is, not cached again. */
      source: () => Promise<T>;
    }
);

/** Everything `defineWidget` assembles a placed widget from. */
export type WidgetDefinition = {
  /** The widget type, as `hangar.yml` names it; the key of an unplaced widget. */
  id: string;
  appearance: WidgetAppearance;
  /**
   * The body, from the widget's module. Settled at once when the module is already loaded, so a warm card still
   * renders without suspending; anything it throws becomes the error state.
   */
  body: () => Promise<WidgetBody>;
  /** How long loaded data stays fresh, in milliseconds. Defaults to {@link TTL}. */
  ttl?: number | undefined;
};

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
  /** The card, from the cache: rendered at once when warm, suspending only when cold. */
  Widget: () => Promise<ReactNode>;
  Skeleton: () => ReactNode;
};

/**
 * How long a widget's data is fresh, when its `hangar.yml` entry does not say. The dashboard has no
 * auto-reload, so this is what a visit sees.
 */
const TTL = 60_000;

/** How long a service that has stopped answering keeps rendering its last good card. */
const GRACE = 900_000;

/** Prefix of every cached card. The cache is process-global and keyed by placement: never put per-session data here. */
const KEY_PREFIX = "widget:";

/** Drops every cached card. Tests only, so one test's data cannot leak into the next. */
export const clearWidgetCache = () => cache.clear(KEY_PREFIX);

/**
 * Wraps a widget: one try/catch, one log, one error fallback. A widget that fails — its module, its service or its
 * render — degrades to its own card; the rest of the dashboard stands.
 */
export function defineWidget({ id, appearance, body, ttl = TTL }: WidgetDefinition): Widget {
  const { title, icon, className, errorDescription } = appearance;

  const fallback = () => <WidgetError className={className} icon={icon} name={title} description={errorDescription} />;
  const skeleton = () => <WidgetSkeleton className={className} icon={icon} title={title} />;

  const at = (key: string): Widget => {
    const show = (widgetBody: WidgetBody) => (data: unknown) => {
      try {
        return widgetBody.render(data, key) ?? fallback();
      } catch (error: unknown) {
        logger.error(`Failed to render the ${title} widget`, { error, placementKey: key });

        return fallback();
      }
    };

    // The rendered card is what gets cached, so a warm widget costs neither the service call nor the render.
    const card = () =>
      chain(body(), widgetBody => {
        if ("source" in widgetBody) {
          return map(widgetBody.source(), show(widgetBody));
        }

        return cache.get(KEY_PREFIX + key, { ttl, maxStale: GRACE }, async () =>
          show(widgetBody)(await widgetBody.load()),
        );
      });

    const failed = (error: unknown) => {
      logger.error(`Failed to load the ${title} widget`, { error, placementKey: key });

      return fallback();
    };

    return {
      id,
      key,
      at,
      Widget: () => {
        // A body that throws before handing back a promise still degrades to this card, not the whole page.
        try {
          return recover(card(), failed);
        } catch (error: unknown) {
          return fulfilled(failed(error));
        }
      },
      Skeleton: skeleton,
    };
  };

  return at(id);
}
