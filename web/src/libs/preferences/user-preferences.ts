import * as cookie from "cookie";
import { Theme, type ColorMode, type ThemePalette } from "./theme.ts";

export type UserPreferences = {
  theme: ColorMode;
  themePalette: ThemePalette;
};

/**
 * The look the user picked, read from its cookies in the browser: the page is a single-page app, which the server
 * sends the same to everyone, so the cookies the settings write are read here, before the first render.
 */
export class UserPreferencesCookies {
  /**
   * Reads the preferences out of a `Cookie` header or `document.cookie`, falling back on the defaults for anything
   * missing or unknown.
   */
  static parse(cookieHeader: string): UserPreferences {
    const cookies = cookie.parseCookie(cookieHeader);
    const theme = cookies[Theme.ColorModeCookie];
    const themePalette = cookies[Theme.PaletteCookie];

    return {
      theme: Theme.isColorMode(theme) ? theme : Theme.DefaultColorMode,
      themePalette: Theme.isPalette(themePalette) ? themePalette : Theme.DefaultPalette,
    };
  }
}
