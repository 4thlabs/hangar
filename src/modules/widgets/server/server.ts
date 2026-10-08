import "server-only";
import { env } from "#libs/env";
import { hangar } from "#libs/hangar/server";
import type { WidgetHost } from "../config/config.ts";
import { WidgetKey } from "../config/widgets.ts";
import { WidgetRegistry } from "../registry.ts";
import { WidgetImages } from "./images.ts";

/**
 * How this Hangar addresses the services its widgets read. Shared by the dashboard and the image relay, so they
 * cannot disagree about a widget's address or key.
 */
export const widgetHost: WidgetHost = {
  domain: env.DOMAIN,
  containerName: app => hangar.store.app(app)?.containerName ?? app,
  secret: container => hangar.store.env.appVar(container, "API_KEY"),
};

/** The dashboard's widgets, resolved against {@link widgetHost}. */
export const widgetRegistry = new WidgetRegistry(widgetHost);

/** The image relay, for the widgets the store places. */
export const widgetImages = new WidgetImages(key => WidgetKey.find(hangar.store.config.widgets(), key), widgetHost);
