import { describe, expect, it } from "vitest";
import { ActionToast } from "./action-toast.ts";

describe("ActionToast.create", () => {
  const titles = { success: "Success", error: "Failure" };

  it("picks the title and type matching the result, keeping the action's own message", () => {
    expect(ActionToast.create({ success: true, message: "Done" }, titles)).toEqual({
      title: "Success",
      description: "Done",
      type: "success",
    });

    expect(ActionToast.create({ success: false, message: "Not done" }, titles)).toEqual({
      title: "Failure",
      description: "Not done",
      type: "error",
    });
  });
});
