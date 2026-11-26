import { describe, expect, it } from "vitest";
import { envChanges } from "./env-changes.ts";

describe("envChanges", () => {
  it("sends what changed since the read, the new variables, and the removed ones the read had", () => {
    const read = { KEPT: "1", SAME: "2", OLD: "3" };
    const values = { KEPT: "one", SAME: "2", NEW: "" };

    expect(envChanges(read, values, ["OLD", "NEVER_READ"])).toEqual({
      updates: { KEPT: "one", NEW: "" },
      remove: ["OLD"],
    });
  });
});
