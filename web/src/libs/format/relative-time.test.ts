import { describe, expect, it } from "vitest";
import { RelativeTime } from "./relative-time.ts";

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const at = (offsetMs: number) => RelativeTime.format(NOW + offsetMs, NOW);

describe("RelativeTime.format", () => {
  it("climbs to the biggest unit that fits", () => {
    expect(at(-30_000)).toBe("30 seconds ago");
    expect(at(-900_000)).toBe("15 minutes ago");
    expect(at(-7_200_000)).toBe("2 hours ago");
    expect(at(-259_200_000)).toBe("3 days ago");
    expect(at(-7_776_000_000)).toBe("3 months ago");
  });

  it("says the nearest moments in words", () => {
    expect(at(0)).toBe("now");
    expect(at(-86_400_000)).toBe("yesterday");
  });

  it("says a moment that is no time, as a date that did not parse, as unknown", () => {
    expect(RelativeTime.format(Date.parse("not a date"), NOW)).toBe("at an unknown time");
    expect(RelativeTime.format(Number.POSITIVE_INFINITY, NOW)).toBe("at an unknown time");
  });
});

describe("RelativeTime.compact", () => {
  const compact = (offsetMs: number) => RelativeTime.compact(NOW + offsetMs, NOW);

  it("writes the past bare and the future with `in`", () => {
    expect(compact(-7_200_000)).toBe("2h");
    expect(compact(79_200_000)).toBe("in 22h");
  });

  it("climbs to the biggest unit that fits", () => {
    expect(compact(-30_000)).toBe("30s");
    expect(compact(-900_000)).toBe("15m");
    expect(compact(-259_200_000)).toBe("3d");
    expect(compact(-7_776_000_000)).toBe("3mo");
  });

  it("says a moment that is no time as unknown", () => {
    expect(RelativeTime.compact(Date.parse("not a date"), NOW)).toBe("at an unknown time");
  });
});
