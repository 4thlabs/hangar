import { describe, expect, it } from "vitest";
import { EnvChangeSet } from "./env-change-set.ts";

describe("EnvChangeSet.create", () => {
  it("sends what changed since the read, the new variables, and the removed ones the read had", () => {
    const read = { KEPT: "1", SAME: "2", OLD: "3" };
    const values = { KEPT: "one", SAME: "2", NEW: "" };

    expect(EnvChangeSet.create(read, values, ["OLD", "NEVER_READ"])).toEqual({
      updates: { KEPT: "one", NEW: "" },
      remove: ["OLD"],
    });
  });
});
