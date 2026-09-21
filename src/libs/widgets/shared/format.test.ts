import { describe, expect, it } from "vitest";
import { formatBytes } from "./format.ts";

describe("formatBytes", () => {
  it("picks the unit that keeps the number readable", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4_509_715_660)).toBe("4.2 GB");
  });

  it("crosses into terabytes rather than reading 1433.6 GB", () => {
    expect(formatBytes(1_526_860_157_747)).toBe("1.4 TB");
  });
});
