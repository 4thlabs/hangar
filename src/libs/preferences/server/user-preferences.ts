import { AsyncLocalStorage } from "node:async_hooks";
import * as cookie from "cookie";
import { Theme, type ColorMode, type ThemePalette } from "../theme.ts";

export type UserPreferences = {
  theme: ColorMode;
  themePalette: ThemePalette;
};

/**
 * The preferences of the user whose request is being rendered, read once from their cookies and
 * carried through the render in an `AsyncLocalStorage`.
 */
export class UserPreferencesStore {
  /** What a render outside any request, or a user with no cookie, gets. */
  private static readonly Defaults: UserPreferences = {
    theme: Theme.DefaultColorMode,
    themePalette: Theme.DefaultPalette,
  };

  /** The preferences of the request in flight. */
  private readonly storage = new AsyncLocalStorage<UserPreferences>();

  /**
   * Reads the preferences out of a `Cookie` header, falling back on the defaults for anything
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

  /**
   * The preferences of the request in flight, or the defaults outside one.
   */
  get(): UserPreferences {
    return this.storage.getStore() ?? UserPreferencesStore.Defaults;
  }

  /**
   * Runs `callback` with `preferences` as the request's own.
   */
  run<T>(preferences: UserPreferences, callback: () => Promise<T>) {
    return this.storage.run(preferences, callback);
  }
}
