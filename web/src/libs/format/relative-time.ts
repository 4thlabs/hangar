/** The units a moment is written in. */
type RelativeUnit = "second" | "minute" | "hour" | "day" | "month";

/**
 * A moment as the distance from now, in English: "2 minutes ago". `now` is always given: in a component it is
 * `useNow()`, since a clock read during render would be kept by the React compiler.
 */
export class RelativeTime {
  /** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
  private static readonly Units: readonly (readonly [seconds: number, unit: RelativeUnit])[] = [
    [60, "second"],
    [3_600, "minute"],
    [86_400, "hour"],
    [2_592_000, "day"],
    [Number.POSITIVE_INFINITY, "month"],
  ];

  private static readonly Format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  /** How a compact moment shortens each unit. */
  private static readonly Suffixes: Readonly<Record<RelativeUnit, string>> = {
    second: "s",
    minute: "m",
    hour: "h",
    day: "d",
    month: "mo",
  };

  /** What a moment that is no time, as a date that did not parse, says. */
  static readonly Unknown = "at an unknown time";

  /** A millisecond timestamp as a phrase: "2 minutes ago"; {@link RelativeTime.Unknown} for one that is no time. */
  static format(timestamp: number, now: number) {
    const seconds = (timestamp - now) / 1_000;
    const rung = RelativeTime.unit(Math.abs(seconds));

    if (rung === undefined) {
      return RelativeTime.Unknown;
    }

    return RelativeTime.Format.format(Math.round(seconds / rung.divisor), rung.unit);
  }

  /**
   * The same moment as short as a dashboard row needs: `18h`, `in 5h`, `3d`; Intl's `narrow` style still says
   * "18 hr. ago". {@link RelativeTime.Unknown} for one that is no time.
   */
  static compact(timestamp: number, now: number) {
    const seconds = (timestamp - now) / 1_000;
    const rung = RelativeTime.unit(Math.abs(seconds));

    if (rung === undefined) {
      return RelativeTime.Unknown;
    }

    const span = `${Math.round(Math.abs(seconds) / rung.divisor)}${RelativeTime.Suffixes[rung.unit]}`;

    return seconds > 0 ? `in ${span}` : span;
  }

  /**
   * The rung of {@link RelativeTime.Units} a span of seconds is written in, and what to divide it by; none for a span
   * that is no number.
   */
  private static unit(absoluteSeconds: number) {
    const index = RelativeTime.Units.findIndex(([threshold]) => absoluteSeconds < threshold);

    if (!Number.isFinite(absoluteSeconds) || index < 0) {
      return undefined;
    }

    const [, unit] = RelativeTime.Units[index]!;

    return { unit, divisor: index === 0 ? 1 : RelativeTime.Units[index - 1]![0] };
  }
}
