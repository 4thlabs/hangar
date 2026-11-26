import type { RouterHistory } from "@tanstack/react-router";
import { createQueryClient } from "#libs/api";
import { Preferences } from "#libs/preferences";
import { Session } from "#modules/auth/api/session.ts";
import { createPageRouter } from "#router.ts";

/** What a page is built with instead of the browser's: a test's history in memory, its own preferences. */
type PageOptions = {
  /** The history the router reads and writes, the browser's unless given. */
  history?: RouterHistory;
  /**
   * The user's preferences. Unless given, they are read from `document.cookie` and their cookies renewed; an instance
   * given, as a test's, is taken as it is, and writes no cookie.
   */
  preferences?: Preferences;
};

/** The preferences `document.cookie` holds, their cookies renewed for another year, defaults included. */
function loadedPreferences(): Preferences {
  const preferences = Preferences.fromCookies(document.cookie);

  preferences.renew();

  return preferences;
}

/**
 * Creates, once, what the page is built on: its query client, its session, its router and its preferences. `main.tsx`
 * calls it, and so do the tests, through `renderAt`.
 */
export function createPage({ history, preferences = loadedPreferences() }: PageOptions = {}) {
  // A 401 of any call sends the page to /login: the session expired, or its user left hangar.yml. The callback runs
  // only once the page is up, when `session` and `router` exist.
  const queryClient = createQueryClient(() => session.signedOut(router));
  const session = new Session(queryClient);
  const router = createPageRouter({ queryClient, session }, history);

  return { queryClient, session, router, preferences };
}
