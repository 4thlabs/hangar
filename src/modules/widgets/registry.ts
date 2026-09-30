import type { Widget } from "./shared/define-widget.tsx";
import type { DashboardColumn, WidgetConfig, WidgetHost } from "./config/config.ts";
import { WidgetService } from "./config/config.ts";
import { arcaneGeneralStats } from "./arcane/general-stats.tsx";
import { backrestSummary } from "./backrest/summary.tsx";
import { beszelServerStats } from "./beszel/server-stats.tsx";
import { dockerGeneralStats } from "./docker/general-stats.tsx";
import { frigateEvents } from "./frigate/events.tsx";
import { gluetunVpnStatus } from "./gluetun/vpn-status.tsx";
import { jellyfinLatest } from "./jellyfin/latest.tsx";
import { minifluxEntries } from "./miniflux/entries.tsx";
import { githubReleases } from "./github/releases.tsx";
import { clockWidget } from "./clock/clock.tsx";

/**
 * The dashboard, as data.
 *
 * Which widgets are shown, and where, is the store's call: `WidgetRegistry`
 * turns the `widgets:` section of its `hangar.yml` into components. Adding a
 * widget is a case here plus its own `defineWidget` call, and a `type` in
 * `config.ts` so the operator can place it; the grid, the Suspense boundary and
 * the error fallback come for free.
 *
 * A widget's API client lives beside it, in `widgets/<service>/api/`.
 *
 * A widget needing per-placement configuration is a factory over its own entry in `hangar.yml` —
 * which, since a placement may set its own cache `ttl`, is every widget that loads anything. One backed by a self-hosted service takes a `WidgetService`: it calls
 * `api` and renders `link`, which are the same address only until the operator says otherwise.
 */
export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

export type { WidgetHost };

/**
 * Turns the store's widget declarations into placed, renderable widgets.
 */
export class WidgetRegistry {
  /** How this Hangar addresses the services its widgets read. */
  private readonly host: WidgetHost;

  /**
   * @param host How this Hangar addresses the services its widgets read
   */
  constructor(host: WidgetHost) {
    this.host = host;
  }

  /**
   * Places every declared widget in its column, in order.
   */
  resolve(configs: readonly WidgetConfig[]): WidgetPlacement[] {
    return configs.map(config => ({ column: config.column, widget: this.create(config) }));
  }

  /**
   * Builds the widget one declaration asks for.
   */
  private create(config: WidgetConfig): Widget {
    const ttl = WidgetRegistry.ttlOf(config);
    const service = () => WidgetService.of(config, this.host);

    switch (config.type) {
      case "clock":
        return clockWidget;
      case "docker-general-stats":
        return dockerGeneralStats(ttl);
      case "arcane-general-stats":
        return arcaneGeneralStats(service(), ttl);
      case "backrest-summary":
        return backrestSummary(service(), ttl);
      case "beszel-server-stats":
        return beszelServerStats(service(), ttl);
      case "frigate-events":
        return frigateEvents(service(), ttl);
      case "miniflux-entries":
        return minifluxEntries(service(), ttl);
      case "gluetun-vpn-status":
        return gluetunVpnStatus(service(), ttl);
      case "jellyfin-latest":
        return jellyfinLatest(service(), config.user, ttl);
      case "github-releases":
        return githubReleases(config.repositories, ttl);
    }
  }

  /**
   * The freshness the declaration asks for, in milliseconds.
   *
   * `hangar.yml` says seconds — that is what an operator writes — and this is the one place it is
   * converted. `undefined` leaves the widget layer's own default in place. The narrowing is for the
   * clock, the one member of the union that carries no `ttl`.
   */
  private static ttlOf(config: WidgetConfig) {
    return "ttl" in config && config.ttl !== undefined ? config.ttl * 1000 : undefined;
  }
}
