/** The units a moment is written in. */
type RelativeUnit = "second" | "minute" | "hour" | "day" | "month";

/** A moment as the distance from now, in English: "2 minutes ago". */
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

  /** A millisecond timestamp as a phrase: "2 minutes ago". */
  static format(timestamp: number, now: number = Date.now()) {
    const seconds = (timestamp - now) / 1_000;
    const { unit, divisor } = RelativeTime.unit(Math.abs(seconds));

    return RelativeTime.Format.format(Math.round(seconds / divisor), unit);
  }

  /** The rung of {@link RelativeTime.Units} a span of seconds is written in, and what to divide it by. */
  private static unit(absoluteSeconds: number) {
    const index = RelativeTime.Units.findIndex(([threshold]) => absoluteSeconds < threshold);
    const [, unit] = RelativeTime.Units[index]!;

    return { unit, divisor: index === 0 ? 1 : RelativeTime.Units[index - 1]![0] };
  }
}
