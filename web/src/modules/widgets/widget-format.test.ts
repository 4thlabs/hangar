import { describe, expect, it } from "vitest";
import { Units } from "./widget-format.ts";

describe("Units.bytes", () => {
  it("picks the unit that keeps the number readable", () => {
    expect(Units.bytes(0)).toBe("0 B");
    expect(Units.bytes(512)).toBe("512 B");
    expect(Units.bytes(4_509_715_660)).toBe("4.2 GB");
  });

  it("crosses into terabytes rather than reading 1433.6 GB", () => {
    expect(Units.bytes(1_526_860_157_747)).toBe("1.4 TB");
  });
});

describe("Units.count", () => {
  it("groups the thousands and says one thing in the singular", () => {
    expect(Units.count(1, "repo", "repos")).toBe("1 repo");
    expect(Units.count(1234, "repo", "repos")).toBe("1,234 repos");
  });
});
