/** The cookies the browser writes for the preferences the server reads on the next render. */
export class PreferenceCookie {
  /** How long a preference cookie lives, in seconds: a year. */
  static readonly MaxAge = 60 * 60 * 24 * 365;

  /**
   * Remembers `value` under `name`, for every path of the site.
   */
  static write(name: string, value: string) {
    const secure = window.location.protocol === "https:" ? "; secure" : "";

    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${PreferenceCookie.MaxAge}; samesite=lax${secure}`;
  }
}
