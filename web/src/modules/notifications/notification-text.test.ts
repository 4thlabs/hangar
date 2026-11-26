import { describe, expect, it } from "vitest";
import type { NotificationMessage } from "#libs/api";
import { NotificationText } from "./notification-text.ts";

describe("NotificationText.describe", () => {
  it("words each key of the server's", () => {
    expect(NotificationText.describe({ key: "storeUpdateFailed" })).toEqual({
      title: "Store: update failed",
      description: "The update of the store failed. See the server's log.",
    });
  });

  it("says a key it does not know, from a newer server, as a plain notification", () => {
    const newer = { key: "updatesAvailable", params: { count: 2 } } as unknown as NotificationMessage;

    expect(NotificationText.describe(newer)).toEqual({ title: "Notification" });
  });
});
