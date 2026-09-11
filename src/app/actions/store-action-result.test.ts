import { describe, expect, it } from "vitest";
import { StoreActionResult } from "./store-action-result.ts";

describe("StoreActionResult", () => {
  it("creates a successful installed result by default", () => {
    expect(StoreActionResult.success("Done")).toEqual({
      success: true,
      installed: true,
      message: "Done",
    });
  });

  it("creates a failed non-installed result by default", () => {
    expect(StoreActionResult.failure("Failed")).toEqual({
      success: false,
      installed: false,
      message: "Failed",
    });
  });

  it("preserves installation state independently from action success", () => {
    expect(StoreActionResult.failure("Update failed", true)).toEqual({
      success: false,
      installed: true,
      message: "Update failed",
    });
  });
});
