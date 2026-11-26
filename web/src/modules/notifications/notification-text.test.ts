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

  it("words a compose command by its operation and its options, as the Waku version does", () => {
    const run = { project: "jellyfin", operation: "up", flags: "pull,forceRecreate" };

    expect(NotificationText.describe({ key: "composeSucceeded", params: run })).toEqual({
      title: "Update and recreate finished",
      description: "jellyfin was updated from its registry and recreated.",
    });

    expect(
      NotificationText.describe({ key: "composeFailed", params: { ...run, operation: "down", flags: "" } }),
    ).toEqual({
      title: "Down failed",
      description: "The Docker Compose command failed for jellyfin. See the server's log.",
    });
  });

  it("words the image check and the update of the apps, as the Waku version does", () => {
    expect(NotificationText.describe({ key: "updatesAvailable", params: { count: 1 } })).toEqual({
      title: "Updates available",
      description: "1 app has a newer image in the registry.",
    });

    expect(NotificationText.describe({ key: "autoUpdate", params: { updated: 2, failed: "" } })).toEqual({
      title: "Automatic update",
      description: "2 apps were updated.",
    });

    expect(NotificationText.describe({ key: "autoUpdate", params: { updated: 1, failed: "alpha, gamma" } })).toEqual({
      title: "Automatic update",
      description: "1 app was updated. Failed for: alpha, gamma.",
    });
  });

  it("says a key it does not know, from a newer server, as a plain notification", () => {
    const newer = {
      key: "backupFailed",
      params: { app: "alpha", error: "disk full" },
    } as unknown as NotificationMessage;

    expect(NotificationText.describe(newer)).toEqual({ title: "Notification" });
  });
});
