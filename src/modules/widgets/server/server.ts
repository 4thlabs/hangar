import "server-only";
import { env } from "#libs/env";
import { hangar } from "#libs/hangar/server";
import { WidgetService, type WidgetHost } from "../config/config.ts";
import { WidgetRegistry } from "../registry.ts";
import { WidgetImages } from "./images.ts";

/**
 * How this Hangar addresses the services its widgets read.
 *
 * The composition root: `config/config.ts` stays free of the store and the environment so the
 * CLI can parse a YAML file without them, and the binding happens here, once. The dashboard and
 * the poster proxy both resolve a service through this, so they cannot disagree about which
 * address or key a widget uses.
 */
export const widgetHost: WidgetHost = {
  domain: env.DOMAIN,
  containerName: app => hangar.store.app(app)?.containerName ?? app,
  secret: container => hangar.store.env.appVar(container, "API_KEY"),
};

/** The dashboard's widgets, resolved against {@link widgetHost}. */
export const widgetRegistry = new WidgetRegistry(widgetHost);

/** The image relay, for the widgets the store places. */
export const widgetImages = new WidgetImages(type =>
  WidgetService.placed(hangar.store.config.widgets(), type, widgetHost),
);
