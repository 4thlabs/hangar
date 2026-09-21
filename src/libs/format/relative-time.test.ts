import { describe, expect, it } from "vitest";
import { formatCompactTime } from "./relative-time.ts";

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const at = (offsetMs: number) => formatCompactTime(NOW + offsetMs, NOW);

describe("formatCompactTime", () => {
  it("writes the past bare and the future with `in`", () => {
    expect(at(-7_200_000)).toBe("2h");
    expect(at(79_200_000)).toBe("in 22h");
  });

  it("climbs to the biggest unit that fits", () => {
    expect(at(-30_000)).toBe("30s");
    expect(at(-900_000)).toBe("15m");
    expect(at(-259_200_000)).toBe("3d");
    expect(at(-7_776_000_000)).toBe("3mo");
  });

  it("rounds at a boundary rather than falling back a unit", () => {
    // 59 minutes is still minutes; 61 is an hour, not "61m".
    expect(at(-3_540_000)).toBe("59m");
    expect(at(-3_660_000)).toBe("1h");
  });
});
