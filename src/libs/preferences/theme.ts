/** A palette the settings page offers, by its stylesheet name. */
export type ThemePalette = (typeof Theme.Palettes)[number]["value"];

/** Light, dark, or whatever the system says. */
export type ColorMode = (typeof Theme.ColorModes)[number]["value"];

/**
 * The look a user picks: a palette and a color mode, remembered in two cookies so the server
 * renders the right one on the first paint.
 */
export class Theme {
  /** Every palette, in the order the settings page lists them. Each has its `theme-<value>.css`. */
  static readonly Palettes = [
    { value: "claude", label: "Claude" },
    { value: "nord", label: "Nord" },
    { value: "nord-frost", label: "Nord Frost" },
    { value: "vintage-paper", label: "Vintage Paper" },
    { value: "vs-code", label: "VS Code" },
    { value: "northern-lights", label: "Northern Lights" },
    { value: "taupe", label: "Taupe" },
    { value: "sunset-horizon", label: "Sunset Horizon" },
  ] as const;

  /** Every color mode, in the order the settings page lists them. */
  static readonly ColorModes = [
    { value: "light", label: "Clair" },
    { value: "dark", label: "Sombre" },
    { value: "system", label: "Système" },
  ] as const;

  /** The palette of a user who never picked one. */
  static readonly DefaultPalette: ThemePalette = "claude";

  /** The color mode of a user who never picked one. */
  static readonly DefaultColorMode: ColorMode = "system";

  /** The cookie holding the color mode. */
  static readonly ColorModeCookie = "theme";

  /** The cookie holding the palette. */
  static readonly PaletteCookie = "theme_palette";

  /** How long both cookies live, in seconds: a year. */
  static readonly CookieMaxAge = 60 * 60 * 24 * 365;

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
    return Theme.ColorModes.some(option => option.value === value);
  }
}
