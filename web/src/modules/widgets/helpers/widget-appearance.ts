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

/** How a widget looks and what names it, as its entry in the registry gives them: its words as `m`'s functions. */
export type WidgetLooks = {
  icon: WidgetIcon;
  /** The size and layout classes of its card. */
  className?: string;
  /** Shown in the header, the skeleton and the error state. */
  title: () => string;
  /** Shown in the error state, below "<title> is unavailable". */
  errorDescription: () => string;
};

/** What names a widget on its card, its skeleton and its error state, its words called. */
export type WidgetLook = {
  /** Shown in the header, the skeleton and the error state. */
  title: string;
  /** Shown in the error state, below "<title> is unavailable". */
  errorDescription: string;
  icon: WidgetIcon;
  /** The size and layout classes of its card. */
  className?: string;
};

/** How the widget whose entry `looks` is looks, its words read now. */
export function widgetLook({ icon, className, title, errorDescription }: WidgetLooks): WidgetLook {
  return {
    icon,
    ...(className === undefined ? {} : { className }),
    title: title(),
    errorDescription: errorDescription(),
  };
}
