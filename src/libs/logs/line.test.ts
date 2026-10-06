import { describe, expect, it } from "vitest";
import { formatLine } from "./line.ts";

const base = { level: "warn", timestamp: "2026-10-05 18:00:00", label: "Hangar" };

describe("formatLine", () => {
  it("prints the message alone when there is no error and no context", () => {
    expect(formatLine({ ...base, message: "Started" })).toBe("[warn] [2026-10-05 18:00:00] [Hangar] : Started");
  });

  it("appends the error after the message", () => {
    expect(formatLine({ ...base, message: "Failed", error: new Error("boom") })).toBe(
      "[warn] [2026-10-05 18:00:00] [Hangar] : Failed, Error: boom",
    );
  });

  it("keeps the context the caller passed, after the error", () => {
    const line = formatLine({
      ...base,
      message: "Could not check an image",
      error: new Error("timeout"),
      image: "nginx:1",
    });

    expect(line).toBe(
      '[warn] [2026-10-05 18:00:00] [Hangar] : Could not check an image, Error: timeout {"image":"nginx:1"}',
    );
  });

  it("leaves out winston's own symbol-keyed fields", () => {
    const line = formatLine({
      ...base,
      message: "Started",
      [Symbol.for("level")]: "warn",
      [Symbol.for("message")]: "raw",
    });

    expect(line).toBe("[warn] [2026-10-05 18:00:00] [Hangar] : Started");
  });
});
