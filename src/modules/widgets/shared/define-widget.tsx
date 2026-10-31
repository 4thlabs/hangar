import type { ReactNode } from "react";
import { chain, fulfilled, map, recover } from "#libs/cache";
import { cache } from "#libs/cache/server";
import { Translation } from "#libs/i18n";
import { logger } from "#libs/logs";
import type { LocaleCode } from "#libs/preferences";
import type { WidgetAppearance } from "../config/config.ts";
import { WidgetError } from "./widget-error.tsx";
import { WidgetSkeleton } from "./widget-skeleton.tsx";

/** What a widget's module contributes: where its data comes from, and how it looks once loaded. */
export type WidgetBody<T = unknown> = {
  /**
   * Renders the loaded data. Return null to fall back to the error state. A method, so any body fits `WidgetBody`.
   * @param placementKey For anything addressed per placement, like a relayed image
   * @param locale The reader's language, which the card is written in
   */
  render(data: T, placementKey: string, locale: LocaleCode): ReactNode;
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
  /** The card in the reader's language, from the cache: rendered at once when warm, suspending only when cold. */
  Widget: (props: WidgetProps) => Promise<ReactNode>;
  Skeleton: (props: WidgetProps) => ReactNode;
};

/** What the dashboard hands every card: the language it is read in. */
export type WidgetProps = { locale: LocaleCode };

/**
 * How long a widget's data is fresh, when its `hangar.yml` entry does not say. The dashboard has no
 * auto-reload, so this is what a visit sees.
 */
const TTL = 60_000;

/** How long a service that has stopped answering keeps rendering its last good card. */
const GRACE = 900_000;

/** Prefix of every cached load. The cache is process-global and keyed by placement: never put per-session data here. */
const KEY_PREFIX = "widget:";

/** Drops every cached load. Tests only, so one test's data cannot leak into the next. */
export const clearWidgetCache = () => cache.clear(KEY_PREFIX);

/**
 * Wraps a widget: one try/catch, one log, one error fallback. A widget that fails — its module, its service or its
 * render — degrades to its own card; the rest of the dashboard stands.
 */
export function defineWidget({ id, appearance, body, ttl = TTL }: WidgetDefinition): Widget {
  const { messages, icon, className } = appearance;
  // The logs read one language whoever renders the card.
  const logTitle = messages.en.title;

  const fallback = (locale: LocaleCode) => {
    const t = Translation.create(messages, locale);

    return (
      <WidgetError
        className={className}
        icon={icon}
        name={t("title")}
        description={t("errorDescription")}
        locale={locale}
      />
    );
  };

  const skeleton = ({ locale }: WidgetProps) => (
    <WidgetSkeleton
      className={className}
      icon={icon}
      title={Translation.create(messages, locale)("title")}
      locale={locale}
    />
  );

  const at = (key: string): Widget => {
    const show = (widgetBody: WidgetBody, locale: LocaleCode) => (data: unknown) => {
      try {
        return widgetBody.render(data, key, locale) ?? fallback(locale);
      } catch (error: unknown) {
        logger.error(`Failed to render the ${logTitle} widget`, { error, placementKey: key });

        return fallback(locale);
      }
    };

    // The loaded data is what gets cached, once per placement whatever the language: a warm widget costs no service
    // call, and each reader's card is rendered from it in their language.
    const card = (locale: LocaleCode) =>
      chain(body(), widgetBody => {
        const data =
          "source" in widgetBody
            ? widgetBody.source()
            : cache.get(KEY_PREFIX + key, { ttl, maxStale: GRACE }, () => widgetBody.load());

        return map(data, show(widgetBody, locale));
      });

    const failed = (locale: LocaleCode) => (error: unknown) => {
      logger.error(`Failed to load the ${logTitle} widget`, { error, placementKey: key });

      return fallback(locale);
    };

    return {
      id,
      key,
      at,
      Widget: ({ locale }) => {
        // A body that throws before handing back a promise still degrades to this card, not the whole page.
        try {
          return recover(card(locale), failed(locale));
        } catch (error: unknown) {
          return fulfilled(failed(locale)(error));
        }
      },
      Skeleton: skeleton,
    };
  };

  return at(id);
}
