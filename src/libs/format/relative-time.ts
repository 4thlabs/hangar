/**
 * A moment as the distance from now: "2 minutes ago", or `2m` where a row has no room.
 *
 * Its own lib rather than the widgets one: the dashboard dates its items with it and so does the
 * notification centre, and the navbar has no business reaching into `#libs/widgets`.
 */
export class RelativeTime {
  /** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
  private static readonly Units: readonly (readonly [
    seconds: number,
    suffix: string,
    unit: Intl.RelativeTimeFormatUnit,
  ])[] = [
    [60, "s", "second"],
    [3_600, "m", "minute"],
    [86_400, "h", "hour"],
    [2_592_000, "d", "day"],
    [Number.POSITIVE_INFINITY, "mo", "month"],
  ];

  /** One formatter per locale, built on first use. */
  private static readonly Formatters = new Map<string, Intl.RelativeTimeFormat>();

  /**
   * A millisecond timestamp as a phrase: "2 minutes ago".
   *
   * @param locale Widgets read English; the notification centre passes "fr".
   */
  static format(timestamp: number, now: number = Date.now(), locale = "en") {
    const seconds = (timestamp - now) / 1_000;
    const { unit, divisor } = RelativeTime.unitOf(Math.abs(seconds));

    return RelativeTime.formatter(locale).format(Math.round(seconds / divisor), unit);
  }

  /**
   * The same moment in as few characters as a dashboard row can spare: `18h`, `in 5h`, `3d`.
   *
   * Not a `style: "narrow"` {@link RelativeTime.format}, which still says "18 hr. ago" — and not a
   * replacement for it either. A row carrying five other facts cannot spend eleven characters on
   * "18 hours ago"; a notification, which carries one, should.
   */
  static compact(timestamp: number, now: number = Date.now()) {
    const seconds = (timestamp - now) / 1_000;
    const absoluteSeconds = Math.abs(seconds);
    const { suffix, divisor } = RelativeTime.unitOf(absoluteSeconds);
    const value = Math.round(absoluteSeconds / divisor);

    return seconds < 0 ? `${value}${suffix}` : `in ${value}${suffix}`;
  }

  /**
   * The rung of {@link RelativeTime.Units} a span of seconds is written in, and what to divide it by.
   */
  private static unitOf(absoluteSeconds: number) {
    const index = RelativeTime.Units.findIndex(([threshold]) => absoluteSeconds < threshold);
    const [, suffix, unit] = RelativeTime.Units[index]!;

    return { suffix, unit, divisor: index === 0 ? 1 : RelativeTime.Units[index - 1]![0] };
  }

  /**
   * The formatter for `locale`, cached: building one is not free and a page formats dozens.
   */
  private static formatter(locale: string) {
    const cached = RelativeTime.Formatters.get(locale);
    if (cached) return cached;

    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    RelativeTime.Formatters.set(locale, formatter);

    return formatter;
  }
}
