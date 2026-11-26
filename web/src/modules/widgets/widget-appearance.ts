import type { WidgetType } from "#libs/api";

/** A widget's icon, as image URLs, and the variant drawn on a dark theme for one the dark background would swallow. */
export class WidgetIcon {
  /** Where Dashboard Icons serves its SVGs. */
  private static readonly DashboardIcons = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg";

  readonly src: string;

  readonly dark: string | undefined;

  constructor(src: string, dark?: string) {
    this.src = src;
    this.dark = dark;
  }

  /** An icon of Dashboard Icons by name, and the name of its dark variant (`github-light`) if it has one. */
  static dashboard(name: string, dark?: string): WidgetIcon {
    const url = (icon: string) => `${WidgetIcon.DashboardIcons}/${icon}.svg`;

    return new WidgetIcon(url(name), dark === undefined ? undefined : url(dark));
  }
}

/** What names a widget on its card, its skeleton and its error state. */
export type WidgetLook = {
  /** Shown in the header, the skeleton and the error state. */
  title: string;
  /** Shown in the error state, below "<title> is unavailable". */
  errorDescription: string;
  icon: WidgetIcon;
  /** The size and layout classes of its card. */
  className?: string;
};

/** How each widget looks before and whatever it loads. */
export class WidgetAppearance {
  private static readonly ByType: Readonly<Record<WidgetType, WidgetLook>> = {
    // Dashboard Icons draws apps, not a plain clock: Fluent Emoji's alarm clock (MIT), served by Hangar itself.
    clock: {
      title: "Clock",
      errorDescription: "The clock could not be rendered.",
      icon: new WidgetIcon("/images/widgets/clock.svg"),
      className: "h-20",
    },
    "docker-general-stats": {
      title: "Local",
      errorDescription: "The local Docker statistics could not be loaded.",
      icon: WidgetIcon.dashboard("docker"),
      className: "@container min-h-64",
    },
    "arcane-general-stats": {
      title: "Arcane",
      errorDescription: "The general statistics could not be loaded.",
      icon: WidgetIcon.dashboard("arcane"),
      className: "@container min-h-64",
    },
    "backrest-summary": {
      title: "Backrest",
      errorDescription: "The backup status could not be loaded.",
      icon: WidgetIcon.dashboard("backrest"),
      className: "min-h-40",
    },
    "beszel-server-stats": {
      title: "Beszel",
      errorDescription: "The server stats could not be loaded.",
      icon: WidgetIcon.dashboard("beszel", "beszel-light"),
      className: "min-h-40",
    },
    "forgejo-ci": {
      title: "Forgejo",
      errorDescription: "The Forgejo Actions runs could not be loaded.",
      icon: WidgetIcon.dashboard("forgejo"),
      className: "min-h-40",
    },
    "frigate-events": {
      title: "Frigate",
      errorDescription: "The camera events could not be loaded.",
      icon: WidgetIcon.dashboard("frigate", "frigate-light"),
      className: "min-h-88",
    },
    "gluetun-vpn-status": {
      title: "Gluetun",
      errorDescription: "The VPN status could not be read.",
      icon: WidgetIcon.dashboard("gluetun"),
      className: "min-h-32",
    },
    "miniflux-entries": {
      title: "Miniflux",
      errorDescription: "The feed entries could not be loaded.",
      icon: WidgetIcon.dashboard("miniflux", "miniflux-light"),
    },
    "jellyfin-latest": {
      title: "Jellyfin",
      errorDescription: "The Jellyfin library could not be loaded.",
      icon: WidgetIcon.dashboard("jellyfin"),
      className: "min-h-64",
    },
    "tcg-collector-cards": {
      title: "TCG Collector",
      errorDescription: "The card prices could not be loaded.",
      icon: new WidgetIcon("/images/widgets/tcg-collector.svg"),
      className: "min-h-48",
    },
    "github-releases": {
      title: "Releases",
      errorDescription: "The GitHub releases could not be loaded.",
      icon: WidgetIcon.dashboard("github", "github-light"),
    },
    "stock-prices": {
      title: "Stocks",
      errorDescription: "The stock prices could not be loaded.",
      icon: new WidgetIcon("/images/widgets/stock.svg"),
      className: "min-h-64",
    },
  };

  /** How a widget of `type` looks. */
  static get(type: WidgetType): WidgetLook {
    return WidgetAppearance.ByType[type];
  }
}
