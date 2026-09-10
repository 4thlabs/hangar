import { AsyncLocalStorage } from "node:async_hooks";
import * as cookie from "cookie";
import { SIDEBAR_STATE_COOKIE_NAME, THEME_COOKIE_NAME, THEME_PALETTE_COOKIE_NAME } from "./shared/constants.ts";
import {
  DEFAULT_COLOR_MODE,
  DEFAULT_THEME_PALETTE,
  isColorMode,
  isThemePalette,
  type ColorMode,
  type ThemePalette,
} from "./shared/themes.ts";

export type ThemePreference = ColorMode;

export type UserPreferences = {
  sidebarOpen: boolean;
  theme: ColorMode;
  themePalette: ThemePalette;
};

const defaultUserPreferences: UserPreferences = {
  sidebarOpen: true,
  theme: DEFAULT_COLOR_MODE,
  themePalette: DEFAULT_THEME_PALETTE,
};

const userPreferencesStore = new AsyncLocalStorage<UserPreferences>();

function parseSidebarState(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultUserPreferences.sidebarOpen;
}

export function parseUserPreferences(cookieHeader: string): UserPreferences {
  const cookies = cookie.parseCookie(cookieHeader);
  const sidebarState = cookies[SIDEBAR_STATE_COOKIE_NAME];
  const theme = cookies[THEME_COOKIE_NAME];
  const themePalette = cookies[THEME_PALETTE_COOKIE_NAME];

  return {
    sidebarOpen: parseSidebarState(sidebarState),
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
