import { describe, expect, it } from "vitest";
import { Units } from "./format.ts";

describe("Units.bytes", () => {
  it("picks the unit that keeps the number readable", () => {
    expect(Units.bytes(0, "en")).toBe("0 B");
    expect(Units.bytes(512, "en")).toBe("512 B");
    expect(Units.bytes(4_509_715_660, "en")).toBe("4.2 GB");
  });

  it("crosses into terabytes rather than reading 1433.6 GB", () => {
    expect(Units.bytes(1_526_860_157_747, "en")).toBe("1.4 TB");
  });

  it("writes the decimal the reader's language writes", () => {
    expect(Units.bytes(4_509_715_660, "fr")).toBe("4,2 GB");
  });
});

describe("Units.integer", () => {
  it("groups thousands the reader's way", () => {
    expect(Units.integer(1234, "en")).toBe("1,234");
    expect(Units.integer(1234, "fr")).toBe("1 234");
  });
});
