import type { Widget } from "./shared/define-widget.tsx";
import type { DashboardColumn, WidgetConfig } from "./config/config.ts";
import { widgetService } from "./config/config.ts";
import { arcaneGeneralStats } from "./arcane/general-stats.tsx";
import { dockerGeneralStats } from "./docker/general-stats.tsx";
import { frigateEvents } from "./frigate/events.tsx";
import { githubReleases } from "./github/releases.tsx";
import { clockWidget } from "./clock/clock.tsx";

/**
 * The dashboard, as data.
 *
 * Which widgets are shown, and where, is the store's call: `resolveWidgets`
 * turns the `widgets:` section of its `hangar.yml` into components. Adding a
 * widget is a case here plus its own `defineWidget` call, and a `type` in
 * `config.ts` so the operator can place it; the grid, the Suspense boundary and
 * the error fallback come for free.
 *
 * A widget's API client lives beside it, in `widgets/<service>/api/`.
 *
 * A widget needing per-placement configuration is a factory over its own entry in `hangar.yml`;
 * the rest are singletons. One backed by a self-hosted service takes a `WidgetService`: it calls
 * `api` and renders `link`, which are the same address only until the operator says otherwise.
 */
export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

/**
 * What the dashboard needs to know to address a service, passed in rather than
 * read here: resolving a container name means reaching for `#libs/hangar`, and
 * that would drag SQLite and Docker into the RSC graph this module sits in.
 */
export type WidgetHost = {
  domain: string;
  /** The container a store app runs under, which names both its public host and its key. */
  containerName: (app: string) => string;
  /** The container's API key, as the store's global env spells it. */
  secret: (container: string) => Promise<string | undefined>;
};

/** `frigate-events` → the `frigate` app: a widget type is prefixed by the app it reads. */
const appOf = (type: string) => type.split("-")[0]!;

const service = (config: { type: string; url?: string | undefined; link?: string | undefined }, host: WidgetHost) =>
  widgetService(config, host.containerName(appOf(config.type)), host.domain, host.secret);

function createWidget(config: WidgetConfig, host: WidgetHost): Widget {
  switch (config.type) {
    case "clock":
      return clockWidget;
    case "docker-general-stats":
      return dockerGeneralStats;
    case "arcane-general-stats":
      return arcaneGeneralStats(service(config, host));
    case "frigate-events":
      return frigateEvents(service(config, host));
    case "github-releases":
      return githubReleases(config.repositories);
  }
}

/** Turns the store's widget declarations into placed, renderable widgets. */
export function resolveWidgets(configs: readonly WidgetConfig[], host: WidgetHost): WidgetPlacement[] {
  return configs.map(config => ({ column: config.column, widget: createWidget(config, host) }));
}
