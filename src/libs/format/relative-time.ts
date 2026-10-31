import { IntlFormats } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";

/** The units a compact moment is written in. */
type CompactUnit = "second" | "minute" | "hour" | "day" | "month";

/**
 * A moment as the distance from now: "2 minutes ago", or `2m` where a row has no room.
 *
 * Its own lib rather than the widgets one: the dashboard dates its items with it and so does the
 * notification centre, and the navbar has no business reaching into `#modules/widgets`.
 */
export class RelativeTime {
  /** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
  private static readonly Units: readonly (readonly [seconds: number, unit: CompactUnit])[] = [
    [60, "second"],
    [3_600, "minute"],
    [86_400, "hour"],
    [2_592_000, "day"],
    [Number.POSITIVE_INFINITY, "month"],
  ];

  /** How each language shortens a unit, and says a moment is ahead: `in 5h`, `dans 5h`. */
  private static readonly Compact: Readonly<
    Record<LocaleCode, { suffixes: Record<CompactUnit, string>; future: (span: string) => string }>
  > = {
    en: { suffixes: { second: "s", minute: "m", hour: "h", day: "d", month: "mo" }, future: span => `in ${span}` },
    fr: {
      suffixes: { second: "s", minute: "min", hour: "h", day: "j", month: "mois" },
      future: span => `dans ${span}`,
    },
  };

  /**
   * A millisecond timestamp as a phrase: "2 minutes ago".
   *
   * @param locale The reader's language
   */
  static format(timestamp: number, now: number = Date.now(), locale: LocaleCode = "en") {
    const seconds = (timestamp - now) / 1_000;
    const { unit, divisor } = RelativeTime.unit(Math.abs(seconds));

    return IntlFormats.relativeTime(locale, { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
  }

  /**
   * The same moment as short as a dashboard row needs: `18h`, `in 5h`, `3d`. Intl's `narrow` style
   * still says "18 hr. ago".
   */
  static compact(timestamp: number, now: number = Date.now(), locale: LocaleCode = "en") {
    const seconds = (timestamp - now) / 1_000;
    const absoluteSeconds = Math.abs(seconds);
    const { unit, divisor } = RelativeTime.unit(absoluteSeconds);
    const { suffixes, future } = RelativeTime.Compact[locale];
    const span = `${Math.round(absoluteSeconds / divisor)}${suffixes[unit]}`;

    return seconds < 0 ? span : future(span);
  }

  /**
   * The rung of {@link RelativeTime.Units} a span of seconds is written in, and what to divide it by.
   */
  private static unit(absoluteSeconds: number) {
    const index = RelativeTime.Units.findIndex(([threshold]) => absoluteSeconds < threshold);
    const [, unit] = RelativeTime.Units[index]!;

    return { unit, divisor: index === 0 ? 1 : RelativeTime.Units[index - 1]![0] };
  }
}
