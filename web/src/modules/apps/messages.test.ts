import { describe, expect, it } from "vitest";
import { appsMessages } from "./messages.ts";

describe("appsMessages", () => {
  it("counts the running containers of an app in the singular for one", () => {
    expect(appsMessages.detail.containersRunning({ running: 1, total: 1 })).toBe("1/1 container running");
    expect(appsMessages.detail.containersRunning({ running: 1, total: 2 })).toBe("1/2 containers running");
  });

  it("counts the events left out of an output in the singular for one", () => {
    expect(appsMessages.compose.skipped({ count: 1 })).toBe(
      "The start of the output is no longer kept: 1 earlier event is left out.",
    );

    expect(appsMessages.compose.skipped({ count: 2 })).toBe(
      "The start of the output is no longer kept: 2 earlier events are left out.",
    );
  });

  it("counts the selected apps in the singular for one", () => {
    expect(appsMessages.list.selected({ count: 1 })).toBe("1 app selected");
    expect(appsMessages.list.selected({ count: 2 })).toBe("2 apps selected");
  });
});
