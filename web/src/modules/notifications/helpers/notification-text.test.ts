import { describe, expect, it } from "vitest";
import type { NotificationMessage } from "#libs/api";
import { describeNotification } from "./notification-text.ts";

describe("describeNotification", () => {
  it("words each key of the server's", () => {
    expect(describeNotification({ key: "storeUpdateFailed" })).toEqual({
      title: "Store: update failed",
      description: "The update of the store failed. See the server's log.",
    });
  });

  it("words a compose command by its operation and its options, as the Waku version does", () => {
    const run = {
      project: "jellyfin",
      action: { operation: "up", pull: true, forceRecreate: true },
    } satisfies Extract<NotificationMessage, { key: "composeSucceeded" }>["params"];

    expect(describeNotification({ key: "composeSucceeded", params: run })).toEqual({
      title: "Update and recreate finished",
      description: "jellyfin was updated from its registry and recreated.",
    });

    expect(describeNotification({ key: "composeFailed", params: { ...run, action: { operation: "down" } } })).toEqual({
      title: "Down failed",
      description: "The Docker Compose command failed for jellyfin. See the server's log.",
    });
  });

  it("words the image check and the update of the apps, as the Waku version does", () => {
    expect(describeNotification({ key: "updatesAvailable", params: { count: 1 } })).toEqual({
      title: "Updates available",
      description: "1 app has a newer image in the registry.",
    });

    expect(describeNotification({ key: "autoUpdate", params: { updated: 2, failed: [] } })).toEqual({
      title: "Automatic update",
      description: "2 apps were updated.",
    });

    expect(describeNotification({ key: "autoUpdate", params: { updated: 1, failed: ["alpha", "gamma"] } })).toEqual({
      title: "Automatic update",
      description: "1 app was updated. Failed for: alpha and gamma.",
    });
  });

  it("words a backup that failed by the code of its error, and the services a backup left down", () => {
    const error = {
      code: "backups.no_data_folder",
      params: { app: "alpha", folder: "alpha/config" },
      message: "alpha has no data folder to back up at app-data/alpha/config",
    } as const;

    expect(describeNotification({ key: "backupFailed", params: { app: "alpha", error } })).toEqual({
      title: "Backup failed",
      description: "The backup of alpha failed: alpha has no data folder to back up at app-data/alpha/config.",
    });

    expect(
      describeNotification({ key: "backupRestartFailed", params: { app: "alpha", services: ["web", "db"] } }),
    ).toEqual({
      title: "App stopped",
      description: "alpha did not restart after its backup: web and db.",
    });
  });

  it("says a key it does not know, from a newer server, as a plain notification", () => {
    const newer = {
      key: "pruneFailed",
      params: { app: "alpha" },
    } as unknown as NotificationMessage;

    expect(describeNotification(newer)).toEqual({ title: "Notification" });
  });
});
