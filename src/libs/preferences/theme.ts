/** A palette the settings page offers, by its stylesheet name. */
export type ThemePalette = (typeof Theme.Palettes)[number]["value"];

/** Light, dark, or whatever the system says. */
export type ColorMode = (typeof Theme.ColorModes)[number];

/**
 * The look a user picks: a palette and a color mode, remembered in two cookies so the server
 * renders the right one on the first paint.
 */
export class Theme {
  /** Every palette, in the order the settings page lists them. Each has its `theme-<value>.css`. */
  static readonly Palettes = [
    { value: "claude", label: "Claude" },
    { value: "nord", label: "Nord" },
  ] as const;

  /** Every color mode, in the order the settings page lists them; their labels are the page's to word. */
  static readonly ColorModes = ["light", "dark", "system"] as const;

  /** The palette of a user who never picked one. */
  static readonly DefaultPalette: ThemePalette = "claude";

  /** The color mode of a user who never picked one. */
  static readonly DefaultColorMode: ColorMode = "system";

  /** The cookie holding the color mode. */
  static readonly ColorModeCookie = "theme";

  /** The cookie holding the palette. */
  static readonly PaletteCookie = "theme_palette";

  /**
   * Whether `value` names one of the {@link Theme.Palettes}.
   */
  static isPalette(value: string | undefined): value is ThemePalette {
    return Theme.Palettes.some(option => option.value === value);
  }

  /**
   * Whether `value` names one of the {@link Theme.ColorModes}.
   */
  static isColorMode(value: string | undefined): value is ColorMode {
    return Theme.ColorModes.some(mode => mode === value);
  }
}
