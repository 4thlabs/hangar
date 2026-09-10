export const THEME_PALETTES = [
  { value: "claude", label: "Claude" },
  { value: "nord", label: "Nord" },
  { value: "nord-frost", label: "Nord Frost" },
  { value: "vintage-paper", label: "Vintage Paper" },
  { value: "vs-code", label: "VS Code" },
  { value: "northern-lights", label: "Northern Lights" },
  { value: "taupe", label: "Taupe" },
  { value: "sunset-horizon", label: "Sunset Horizon" },
] as const;

export const COLOR_MODES = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "system", label: "Système" },
] as const;

export type ThemePalette = (typeof THEME_PALETTES)[number]["value"];
export type ColorMode = (typeof COLOR_MODES)[number]["value"];

export const DEFAULT_THEME_PALETTE: ThemePalette = "claude";
export const DEFAULT_COLOR_MODE: ColorMode = "system";

export function isThemePalette(value: string | undefined): value is ThemePalette {
  return THEME_PALETTES.some(option => option.value === value);
}

export function isColorMode(value: string | undefined): value is ColorMode {
  return COLOR_MODES.some(option => option.value === value);
}
