// The look a user picks: a palette and a color mode, remembered in two cookies, which `index.html` applies before the
// first paint.

/** Every palette, in the order the settings page lists them. Each has its `theme-<value>.css`. */
export const themePalettes = [
  { value: "claude", label: "Claude" },
  { value: "nord", label: "Nord" },
] as const;

/** Every color mode, in the order the settings page lists them; their labels are the page's to word. */
export const colorModes = ["light", "dark", "system"] as const;

/** A palette the settings page offers, by its stylesheet name. */
export type ThemePalette = (typeof themePalettes)[number]["value"];

/** Light, dark, or whatever the system says. */
export type ColorMode = (typeof colorModes)[number];

/** The palette of a user who never picked one. */
export const defaultPalette: ThemePalette = "claude";

/** The color mode of a user who never picked one. */
export const defaultColorMode: ColorMode = "system";

/** The cookie holding the color mode. */
export const colorModeCookie = "theme";

/** The cookie holding the palette. */
export const paletteCookie = "theme_palette";

/** Whether `value` names one of the {@link themePalettes}. */
export function isThemePalette(value: string | undefined): value is ThemePalette {
  return themePalettes.some(option => option.value === value);
}

/** Whether `value` names one of the {@link colorModes}. */
export function isColorMode(value: string | undefined): value is ColorMode {
  return colorModes.some(mode => mode === value);
}
