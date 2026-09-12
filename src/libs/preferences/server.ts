import { AsyncLocalStorage } from "node:async_hooks";
import * as cookie from "cookie";
import { THEME_COOKIE_NAME, THEME_PALETTE_COOKIE_NAME } from "./shared/constants.ts";
import {
  DEFAULT_COLOR_MODE,
  DEFAULT_THEME_PALETTE,
  isColorMode,
  isThemePalette,
  type ColorMode,
  type ThemePalette,
} from "./shared/themes.ts";

export type UserPreferences = {
  theme: ColorMode;
  themePalette: ThemePalette;
};

const defaultUserPreferences: UserPreferences = {
  theme: DEFAULT_COLOR_MODE,
  themePalette: DEFAULT_THEME_PALETTE,
};

const userPreferencesStore = new AsyncLocalStorage<UserPreferences>();

export function parseUserPreferences(cookieHeader: string): UserPreferences {
  const cookies = cookie.parseCookie(cookieHeader);
  const theme = cookies[THEME_COOKIE_NAME];
  const themePalette = cookies[THEME_PALETTE_COOKIE_NAME];

  return {
    theme: isColorMode(theme) ? theme : DEFAULT_COLOR_MODE,
    themePalette: isThemePalette(themePalette) ? themePalette : DEFAULT_THEME_PALETTE,
  };
}

export function getUserPreferences() {
  return userPreferencesStore.getStore() ?? defaultUserPreferences;
}

export function runWithUserPreferences<T>(preferences: UserPreferences, callback: () => Promise<T>) {
  return userPreferencesStore.run(preferences, callback);
}
