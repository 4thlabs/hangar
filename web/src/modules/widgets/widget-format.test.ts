import { describe, expect, it } from "vitest";
import { formatCount, formatSize } from "./widget-format.ts";

describe("formatSize", () => {
  it("picks the unit that keeps the number readable", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(4_509_715_660)).toBe("4.2 GB");
  });

  it("crosses into terabytes rather than reading 1433.6 GB", () => {
    expect(formatSize(1_526_860_157_747)).toBe("1.4 TB");
  });
});

describe("formatCount", () => {
  it("groups the thousands and says one thing in the singular", () => {
    expect(formatCount(1, "repo", "repos")).toBe("1 repo");
    expect(formatCount(1234, "repo", "repos")).toBe("1,234 repos");
  });
});
