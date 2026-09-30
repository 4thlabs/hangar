import { describe, expect, it } from "vitest";
import { createActionToast } from "./action-toast.ts";

describe("createActionToast", () => {
  const titles = { success: "Success", error: "Failure" };

  it("picks the title and type matching the result, keeping the action's own message", () => {
    expect(createActionToast({ success: true, message: "Done" }, titles)).toEqual({
      title: "Success",
      description: "Done",
      type: "success",
    });
    expect(createActionToast({ success: false, message: "Not done" }, titles)).toEqual({
      title: "Failure",
      description: "Not done",
      type: "error",
    });
  });
});
