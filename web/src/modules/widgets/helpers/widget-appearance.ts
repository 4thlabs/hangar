import type { WidgetType } from "#libs/api";
import { widgetsLabels } from "#modules/widgets/helpers/widgets-labels.ts";

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

/** How each widget looks before and whatever it loads, but its words, which are `widgetsLabels.looks`. */
const looksByType: Readonly<Record<WidgetType, Omit<WidgetLook, "title" | "errorDescription">>> = {
  // Dashboard Icons draws apps, not a plain clock: Fluent Emoji's alarm clock (MIT), served by Hangar itself.
  clock: {
    icon: new WidgetIcon("/images/widgets/clock.svg"),
    className: "h-20",
  },
  "docker-general-stats": {
    icon: WidgetIcon.dashboard("docker"),
    className: "@container min-h-64",
  },
  "arcane-general-stats": {
    icon: WidgetIcon.dashboard("arcane"),
    className: "@container min-h-64",
  },
  "backrest-summary": {
    icon: WidgetIcon.dashboard("backrest"),
    className: "min-h-40",
  },
  "beszel-server-stats": {
    icon: WidgetIcon.dashboard("beszel", "beszel-light"),
    className: "min-h-40",
  },
  "forgejo-ci": {
    icon: WidgetIcon.dashboard("forgejo"),
    className: "min-h-40",
  },
  "frigate-events": {
    icon: WidgetIcon.dashboard("frigate", "frigate-light"),
    className: "min-h-88",
  },
  "gluetun-vpn-status": {
    icon: WidgetIcon.dashboard("gluetun"),
    className: "min-h-32",
  },
  "miniflux-entries": {
    icon: WidgetIcon.dashboard("miniflux", "miniflux-light"),
  },
  "jellyfin-latest": {
    icon: WidgetIcon.dashboard("jellyfin"),
    className: "min-h-64",
  },
  "tcg-collector-cards": {
    icon: new WidgetIcon("/images/widgets/tcg-collector.svg"),
    className: "min-h-48",
  },
  "github-releases": {
    icon: WidgetIcon.dashboard("github", "github-light"),
  },
  "stock-prices": {
    icon: new WidgetIcon("/images/widgets/stock.svg"),
    className: "min-h-64",
  },
};

/** How a widget of `type` looks. */
export function widgetLook(type: WidgetType): WidgetLook {
  const labels = widgetsLabels.looks[type];

  return { ...looksByType[type], title: labels.title(), errorDescription: labels.errorDescription() };
}
