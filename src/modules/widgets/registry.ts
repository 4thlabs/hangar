import type { Widget } from "./shared/define-widget.tsx";
import type { DashboardColumn, WidgetConfig, WidgetHost } from "./config/config.ts";
import { WidgetKey, WidgetService } from "./config/config.ts";
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

/** A widget and the dashboard column it sits in. */
export type WidgetPlacement = {
  column: DashboardColumn;
  widget: Widget;
};

export type { WidgetHost };

/**
 * Turns the store's widget declarations into placed, renderable widgets. Adding a widget: a `type` in config.ts, a
 * case in `create`, its own `defineWidget`, and an entry in `WidgetImages` if it relays images.
 */
export class WidgetRegistry {
  /** How this Hangar addresses the services its widgets read. */
  private readonly host: WidgetHost;

  constructor(host: WidgetHost) {
    this.host = host;
  }

  /**
   * Places every declared widget in its column, in order, each bound to its own key — two
   * placements of one type read two cache entries, not whichever loaded first.
   */
  resolve(configs: readonly WidgetConfig[]): WidgetPlacement[] {
    const keys = WidgetKey.all(configs);

    return configs.map((config, index) => ({ column: config.column, widget: this.create(config).at(keys[index]!) }));
  }

  /** Builds the widget one declaration asks for. */
  private create(config: WidgetConfig): Widget {
    const ttl = WidgetRegistry.ttlOf(config);
    const service = () => WidgetService.of(config, this.host);

    switch (config.type) {
      case "clock":
        return clockWidget;
      case "docker-general-stats":
        return dockerGeneralStats;
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

  /** The declaration's `ttl` in milliseconds (`hangar.yml` says seconds); `undefined` keeps the widget default. */
  private static ttlOf(config: WidgetConfig) {
    return "ttl" in config && config.ttl !== undefined ? config.ttl * 1000 : undefined;
  }
}
