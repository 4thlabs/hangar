/** How long a preference cookie lives, in seconds: a year. */
const maxAge = 60 * 60 * 24 * 365;

/** Remembers `value` under `name`, for every path of the site, for the page to read at its next load. */
export function writePreferenceCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
