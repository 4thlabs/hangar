/** A user preference kept in a cookie, for the server to render with on the next request. */
export class PreferenceCookie {
  /** How long a preference is kept, in seconds: a year. */
  private static readonly MaxAge = 60 * 60 * 24 * 365;

  /** Sets the cookie for {@link PreferenceCookie.MaxAge}, scoped to the whole app. */
  static write(name: string, value: string) {
    const secure = window.location.protocol === "https:" ? "; secure" : "";

    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${PreferenceCookie.MaxAge}; samesite=lax${secure}`;
  }
}
