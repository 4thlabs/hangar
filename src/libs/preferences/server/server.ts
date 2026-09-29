import "server-only";

import { UserPreferencesStore } from "./user-preferences.ts";

/** The store every render reads through. */
export const userPreferences = new UserPreferencesStore();
