const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

const relativeTimeFormatter = (locale: string) => {
  const cached = relativeTimeFormatters.get(locale);
  if (cached) return cached;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  relativeTimeFormatters.set(locale, formatter);

  return formatter;
};

/** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
const UNITS: readonly (readonly [seconds: number, suffix: string, unit: Intl.RelativeTimeFormatUnit])[] = [
  [60, "s", "second"],
  [3_600, "m", "minute"],
  [86_400, "h", "hour"],
  [2_592_000, "d", "day"],
  [Number.POSITIVE_INFINITY, "mo", "month"],
];

/** The rung of {@link UNITS} a span of seconds is written in, and what to divide it by. */
function unitOf(absoluteSeconds: number) {
  const index = UNITS.findIndex(([threshold]) => absoluteSeconds < threshold);
  const [, suffix, unit] = UNITS[index]!;

  return { suffix, unit, divisor: index === 0 ? 1 : UNITS[index - 1]![0] };
}

/**
 * A millisecond timestamp as a phrase: "2 minutes ago".
 *
 * Its own lib rather than the widgets one: the dashboard dates its items with it and so does the
 * notification centre, and the navbar has no business reaching into `#libs/widgets`.
 *
 * @param locale Widgets read English; the notification centre passes "fr".
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now(), locale = "en") {
  const seconds = (timestamp - now) / 1_000;
  const { unit, divisor } = unitOf(Math.abs(seconds));

  return relativeTimeFormatter(locale).format(Math.round(seconds / divisor), unit);
}

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
  const { suffix, divisor } = unitOf(absoluteSeconds);
  const value = Math.round(absoluteSeconds / divisor);

  return seconds < 0 ? `${value}${suffix}` : `in ${value}${suffix}`;
}
