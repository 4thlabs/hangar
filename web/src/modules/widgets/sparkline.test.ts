import { describe, expect, it } from "vitest";
import { Sparkline } from "./sparkline.ts";

const box = { width: 100, height: 20 };

describe("Sparkline.polylines", () => {
  it("spreads the days across the width, the lowest price at the bottom and the highest at the top", () => {
    expect(Sparkline.polylines([1, 3, 2], box)).toEqual(["0,20 50,0 100,10"]);
  });

  it("draws nothing for a series with no known price", () => {
    expect(Sparkline.polylines([], box)).toEqual([]);
    expect(Sparkline.polylines([null, null], box)).toEqual([]);
  });

  it("draws a lone price as a dot in the middle", () => {
    // A repeated point is a zero-length line, which a round cap renders as a dot.
    expect(Sparkline.polylines([4.2], box)).toEqual(["50,10 50,10"]);
  });

  it("runs a flat series through the middle rather than along an edge", () => {
    expect(Sparkline.polylines([2, 2, 2], box)).toEqual(["0,10 50,10 100,10"]);
  });

  it("breaks the curve at an unknown price instead of dropping it to zero", () => {
    expect(Sparkline.polylines([1, 2, null, 3, 1], box)).toEqual(["0,20 25,10", "75,0 100,20"]);
  });

  it("keeps a day's place when the run around it is a single price", () => {
    expect(Sparkline.polylines([null, 1, null, 3], box)).toEqual(["33.33,20 33.33,20", "100,0 100,0"]);
  });
});
