import { describe, expect, it } from "vitest";
import { MetricFormat } from "./format.ts";

describe("MetricFormat", () => {
  it("writes sizes in binary units, in the reader's language", () => {
    expect(MetricFormat.bytes(1536, "en")).toBe("1.5 KiB");
    expect(MetricFormat.bytes(1536, "fr")).toBe("1,5 KiB");
    expect(MetricFormat.bytes(0, "en")).toBe("0 B");
    expect(MetricFormat.bytes(null, "fr")).toBe("—");
  });

  it("writes shares to one decimal, in the reader's language", () => {
    expect(MetricFormat.percent(12.5, "en")).toBe("12.5%");
    expect(MetricFormat.percent(12.5, "fr")).toBe("12,5\u00a0%");
    expect(MetricFormat.percent(null, "en")).toBe("—");
  });
});
