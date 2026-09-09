import { AsyncLocalStorage } from "node:async_hooks";
import * as cookie from "cookie";
import { SIDEBAR_STATE_COOKIE_NAME, THEME_COOKIE_NAME } from "./constants.ts";

export type ThemePreference = "dark" | "light" | "system";

export type UserPreferences = {
  sidebarOpen: boolean;
  theme: ThemePreference;
};

const defaultUserPreferences: UserPreferences = {
  sidebarOpen: true,
  theme: "system",
};

const userPreferencesStore = new AsyncLocalStorage<UserPreferences>();

function parseSidebarState(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultUserPreferences.sidebarOpen;
}

function parseTheme(value: string | undefined): ThemePreference {
  if (value === "dark" || value === "light") return value;
  return "system";
}

export function parseUserPreferences(cookieHeader: string): UserPreferences {
  const cookies = cookie.parseCookie(cookieHeader);
  const sidebarState = cookies[SIDEBAR_STATE_COOKIE_NAME];

  return {
    sidebarOpen: parseSidebarState(sidebarState),
    theme: parseTheme(cookies[THEME_COOKIE_NAME]),
  };
}

export function getUserPreferences() {
  return userPreferencesStore.getStore() ?? defaultUserPreferences;
}

export function runWithUserPreferences<T>(preferences: UserPreferences, callback: () => Promise<T>) {
  return userPreferencesStore.run(preferences, callback);
}
