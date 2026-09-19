import "server-only";
import { env } from "#libs/env";
import { hangar } from "#libs/hangar/server";
import { serviceOf, type WidgetConfig, type WidgetHost, type WidgetService } from "../config/config.ts";

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

/**
 * The service a placed widget talks to, for code that is not the dashboard.
 *
 * `undefined` when the store does not place that widget, which is the honest answer for a route
 * asked to proxy for something the operator never configured.
 * @param type The widget type, as `hangar.yml` declares it
 */
export function serviceFor(type: WidgetConfig["type"]): WidgetService | undefined {
  const config = hangar.store.config.widgets().find(widget => widget.type === type);

  return config && serviceOf(config, widgetHost);
}
