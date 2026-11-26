import { createContext, use, useSyncExternalStore } from "react";
import type { Preferences, UserPreferences } from "#libs/preferences";

/** The page's `Preferences`, which `AppProviders` hands down from `createPage`. */
export const PreferencesContext = createContext<Preferences | null>(null);

/** The user's preferences, rendered again on each change `Preferences.set` makes. */
export function usePreferences(): UserPreferences {
  const preferences = use(PreferencesContext);

  if (!preferences) {
    throw new Error("usePreferences is called outside AppProviders, which hands down the page's Preferences");
  }

  return useSyncExternalStore(
    listener => preferences.subscribe(listener),
    () => preferences.current,
  );
}
