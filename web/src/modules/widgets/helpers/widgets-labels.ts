import type { WidgetType } from "#libs/api";
import { m } from "#paraglide/messages.js";

/** What names a widget on its card, its skeleton and its error state. */
type LookWords = { title: () => string; errorDescription: () => string };

/** The words of each value `widgets` shows a label of, by the type that lists them: a new value is a type error here. */
export const widgetsLabels = {
  /** What names each widget on its card, its skeleton and its error state. */
  looks: {
    clock: { title: m.widgets_clock_title, errorDescription: m.widgets_clock_error_description },
    "docker-general-stats": {
      title: m.widgets_docker_general_stats_title,
      errorDescription: m.widgets_docker_general_stats_error_description,
    },
    "arcane-general-stats": {
      title: m.widgets_arcane_general_stats_title,
      errorDescription: m.widgets_arcane_general_stats_error_description,
    },
    "backrest-summary": {
      title: m.widgets_backrest_summary_title,
      errorDescription: m.widgets_backrest_summary_error_description,
    },
    "beszel-server-stats": {
      title: m.widgets_beszel_server_stats_title,
      errorDescription: m.widgets_beszel_server_stats_error_description,
    },
    "forgejo-ci": { title: m.widgets_forgejo_ci_title, errorDescription: m.widgets_forgejo_ci_error_description },
    "frigate-events": {
      title: m.widgets_frigate_events_title,
      errorDescription: m.widgets_frigate_events_error_description,
    },
    "gluetun-vpn-status": {
      title: m.widgets_gluetun_vpn_status_title,
      errorDescription: m.widgets_gluetun_vpn_status_error_description,
    },
    "miniflux-entries": {
      title: m.widgets_miniflux_entries_title,
      errorDescription: m.widgets_miniflux_entries_error_description,
    },
    "jellyfin-latest": {
      title: m.widgets_jellyfin_latest_title,
      errorDescription: m.widgets_jellyfin_latest_error_description,
    },
    "tcg-collector-cards": {
      title: m.widgets_tcg_collector_cards_title,
      errorDescription: m.widgets_tcg_collector_cards_error_description,
    },
    "github-releases": {
      title: m.widgets_github_releases_title,
      errorDescription: m.widgets_github_releases_error_description,
    },
    "stock-prices": {
      title: m.widgets_stock_prices_title,
      errorDescription: m.widgets_stock_prices_error_description,
    },
  } satisfies Record<WidgetType, LookWords>,
  /** The games tcg-collector collects, by Cardmarket's game id. */
  games: new Map<number, () => string>([
    [1, m.widgets_games_magic],
    [21, m.widgets_games_star_wars_unlimited],
  ]),
};
