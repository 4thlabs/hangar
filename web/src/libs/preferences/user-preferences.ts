import * as cookie from "cookie";
import {
  colorModeCookie,
  defaultColorMode,
  defaultPalette,
  isColorMode,
  isThemePalette,
  paletteCookie,
  type ColorMode,
  type ThemePalette,
} from "./theme.ts";

/** The look the user picked. */
export type UserPreferences = {
  theme: ColorMode;
  themePalette: ThemePalette;
};

/**
 * Reads the preferences out of a `Cookie` header or `document.cookie`, falling back on the defaults for anything
 * missing or unknown. The page is a single-page app, which the server sends the same to everyone, so the cookies the
 * settings write are read in the browser, before the first render.
 */
export function parsePreferences(cookieHeader: string): UserPreferences {
  const cookies = cookie.parseCookie(cookieHeader);
  const theme = cookies[colorModeCookie];
  const themePalette = cookies[paletteCookie];

  return {
    theme: isColorMode(theme) ? theme : defaultColorMode,
    themePalette: isThemePalette(themePalette) ? themePalette : defaultPalette,
  };
}
