import { writePreferenceCookie } from "./preference-cookie.ts";
import { colorModeCookie, paletteCookie } from "./theme.ts";
import { parsePreferences, type UserPreferences } from "./user-preferences.ts";

/**
 * The user's preferences while the page is open: the ones the cookies gave at its load, then each change `set` makes,
 * which it writes to the cookies for the next load and tells every subscriber. `createPage` creates the one instance,
 * and `usePreferences()` reads it.
 */
export class Preferences {
  #current: UserPreferences;
  readonly #listeners = new Set<() => void>();

  constructor(initial: UserPreferences) {
    this.#current = initial;
  }

  /** The preferences `cookieHeader` holds, as `document.cookie`, with the defaults for what it does not. */
  static fromCookies(cookieHeader: string): Preferences {
    return new Preferences(parsePreferences(cookieHeader));
  }

  /** The preferences now: the same object until a change, as `useSyncExternalStore` needs. */
  get current(): UserPreferences {
    return this.#current;
  }

  /**
   * Writes the cookies of every preference now, the defaults included, each for a year from now: the page calls it at
   * its load, so that a preference picked once does not expire while the page is in use.
   */
  renew(): void {
    writePreferenceCookie(colorModeCookie, this.#current.theme);
    writePreferenceCookie(paletteCookie, this.#current.themePalette);
  }

  /** Changes the preferences `change` names, writes their cookies, and tells the subscribers. */
  set(change: Partial<UserPreferences>): void {
    this.#current = { ...this.#current, ...change };

    if (change.theme !== undefined) {
      writePreferenceCookie(colorModeCookie, change.theme);
    }

    if (change.themePalette !== undefined) {
      writePreferenceCookie(paletteCookie, change.themePalette);
    }

    for (const listener of this.#listeners) {
      listener();
    }
  }

  /** Calls `listener` after each change, until the function it returns is called. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }
}
