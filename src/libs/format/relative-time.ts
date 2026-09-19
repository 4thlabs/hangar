const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

const relativeTimeFormatter = (locale: string) => {
  const cached = relativeTimeFormatters.get(locale);
  if (cached) return cached;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  relativeTimeFormatters.set(locale, formatter);

  return formatter;
};

/**
 * A millisecond timestamp as a phrase: "2 minutes ago".
 *
 * Its own lib rather than the widgets one: the dashboard dates its items with it and so does the
 * notification centre, and the navbar has no business reaching into `#libs/widgets`.
 *
 * @param locale Widgets read English; the notification centre passes "fr".
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now(), locale = "en") {
  const formatter = relativeTimeFormatter(locale);
  const seconds = (timestamp - now) / 1_000;
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 60) return formatter.format(Math.round(seconds), "second");
  if (absoluteSeconds < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  if (absoluteSeconds < 2_592_000) return formatter.format(Math.round(seconds / 86_400), "day");
  return formatter.format(Math.round(seconds / 2_592_000), "month");
}
