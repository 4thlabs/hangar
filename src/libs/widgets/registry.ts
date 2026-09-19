import type { Widget } from "./shared/define-widget.tsx";
import type { DashboardColumn, WidgetConfig, WidgetHost } from "./config/config.ts";
import { serviceOf } from "./config/config.ts";
import { arcaneGeneralStats } from "./arcane/general-stats.tsx";
import { dockerGeneralStats } from "./docker/general-stats.tsx";
import { frigateEvents } from "./frigate/events.tsx";
import { gluetunVpnStatus } from "./gluetun/vpn-status.tsx";
import { jellyfinLatest } from "./jellyfin/latest.tsx";
import { jellyfinStats } from "./jellyfin/stats.tsx";
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

export type { WidgetHost };

function createWidget(config: WidgetConfig, host: WidgetHost): Widget {
  switch (config.type) {
    case "clock":
      return clockWidget;
    case "docker-general-stats":
      return dockerGeneralStats;
    case "arcane-general-stats":
      return arcaneGeneralStats(serviceOf(config, host));
    case "frigate-events":
      return frigateEvents(serviceOf(config, host));
    case "gluetun-vpn-status":
      return gluetunVpnStatus(serviceOf(config, host));
    case "jellyfin-stats":
      return jellyfinStats(serviceOf(config, host));
    case "jellyfin-latest":
      return jellyfinLatest(serviceOf(config, host), config.user);
    case "github-releases":
      return githubReleases(config.repositories);
  }
}

/** Turns the store's widget declarations into placed, renderable widgets. */
export function resolveWidgets(configs: readonly WidgetConfig[], host: WidgetHost): WidgetPlacement[] {
  return configs.map(config => ({ column: config.column, widget: createWidget(config, host) }));
}
