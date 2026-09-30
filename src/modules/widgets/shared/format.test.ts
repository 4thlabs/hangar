import { describe, expect, it } from "vitest";
import { Units } from "./format.ts";

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
