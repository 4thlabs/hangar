// A moment as the distance from now, in English: "2 minutes ago". `now` is always given: in a component it is
// `useNow()`, since a clock read during render would be kept by the React compiler.

/** The units a moment is written in. */
type RelativeUnit = "second" | "minute" | "hour" | "day" | "month";

/** The unit ladder, largest threshold last: a moment is written in the biggest unit that fits. */
const units: readonly (readonly [seconds: number, unit: RelativeUnit])[] = [
  [60, "second"],
  [3_600, "minute"],
  [86_400, "hour"],
  [2_592_000, "day"],
  [Number.POSITIVE_INFINITY, "month"],
];

const phrase = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** How a compact moment shortens each unit. */
const suffixes: Readonly<Record<RelativeUnit, string>> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  month: "mo",
};

/** What a moment that is no time, as a date that did not parse, says. */
export const unknownTime = "at an unknown time";

/** A millisecond timestamp as a phrase: "2 minutes ago"; {@link unknownTime} for one that is no time. */
export function relativeTime(timestamp: number, now: number) {
  const seconds = (timestamp - now) / 1_000;
  const rung = unitOf(Math.abs(seconds));

  if (rung === undefined) {
    return unknownTime;
  }

  return phrase.format(Math.round(seconds / rung.divisor), rung.unit);
}

/**
 * The same moment as short as a dashboard row needs: `18h`, `in 5h`, `3d`; Intl's `narrow` style still says
 * "18 hr. ago". {@link unknownTime} for one that is no time.
 */
export function compactRelativeTime(timestamp: number, now: number) {
  const seconds = (timestamp - now) / 1_000;
  const rung = unitOf(Math.abs(seconds));

  if (rung === undefined) {
    return unknownTime;
  }

  const span = `${Math.round(Math.abs(seconds) / rung.divisor)}${suffixes[rung.unit]}`;

  return seconds > 0 ? `in ${span}` : span;
}

/**
 * The rung of {@link units} a span of seconds is written in, and what to divide it by; none for a span that is no
 * number.
 */
function unitOf(absoluteSeconds: number) {
  const index = units.findIndex(([threshold]) => absoluteSeconds < threshold);

  if (!Number.isFinite(absoluteSeconds) || index < 0) {
    return undefined;
  }

  const [, unit] = units[index]!;

  return { unit, divisor: index === 0 ? 1 : units[index - 1]![0] };
}
