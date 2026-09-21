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

/** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
const COMPACT_UNITS: readonly (readonly [seconds: number, suffix: string])[] = [
  [60, "s"],
  [3_600, "m"],
  [86_400, "h"],
  [2_592_000, "d"],
  [Number.POSITIVE_INFINITY, "mo"],
];

/**
 * The same moment in as few characters as a dashboard row can spare: `18h`, `in 5h`, `3d`.
 *
 * Not a `style: "narrow"` {@link formatRelativeTime}, which still says "18 hr. ago" — and not a
 * replacement for it either. A row carrying five other facts cannot spend eleven characters on
 * "18 hours ago"; a notification, which carries one, should.
 */
export function formatCompactTime(timestamp: number, now: number = Date.now()) {
  const seconds = (timestamp - now) / 1_000;
  const absoluteSeconds = Math.abs(seconds);
  const index = COMPACT_UNITS.findIndex(([threshold]) => absoluteSeconds < threshold);
  const [, suffix] = COMPACT_UNITS[index]!;
  const divisor = index === 0 ? 1 : COMPACT_UNITS[index - 1]![0];
  const value = Math.round(absoluteSeconds / divisor);

  return seconds < 0 ? `${value}${suffix}` : `in ${value}${suffix}`;
}
