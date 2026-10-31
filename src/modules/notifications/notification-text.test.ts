import { describe, expect, it, vi } from "vitest";
import { Notifications, type NotificationPayload } from "#libs/notifications";
import { NotificationText } from "./notification-text.ts";

const payload = (overrides: Partial<NotificationPayload>): NotificationPayload => ({
  id: "1",
  level: "info",
  message: null,
  title: "",
  description: null,
  href: null,
  seen: false,
  read: false,
  createdAt: 0,
  ...overrides,
});

describe("NotificationText", () => {
  it("renders the same notification in each language", () => {
    const notification = payload({ message: Notifications.message("updatesAvailable", { count: 1 }) });

    expect(NotificationText.render(notification, "en")).toEqual({
      title: "Updates available",
      description: "1 app has a newer image in the registry.",
    });

    expect(NotificationText.render(notification, "fr")).toEqual({
      title: "Mises à jour disponibles",
      description: "1 application a une image plus récente en registre.",
    });
  });

  it("names a compose run after its command", () => {
    const message = Notifications.message("composeSucceeded", { project: "whoami", operation: "up", flags: "pull" });

    expect(NotificationText.render(payload({ message }), "en")).toEqual({
      title: "Update finished",
      description: "whoami was updated from its registry.",
    });
  });

  it("shows a row filed before messages as it was stored", () => {
    const legacy = payload({ title: "Sauvegarde échouée", description: "Disque plein" });

    expect(NotificationText.render(legacy, "en")).toEqual({ title: "Sauvegarde échouée", description: "Disque plein" });
  });

  it("reads as a plain notification when this version no longer has its key", () => {
    const dropped = payload({ title: "gone", message: { key: "gone", params: {} } });

    expect(NotificationText.render(dropped, "fr")).toEqual({ title: "Notification" });
  });

  it("reads as a plain notification rather than failing when its parameters no longer fit", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const malformed = payload({ message: { key: "composeSucceeded", params: { project: "whoami" } } });

    expect(NotificationText.render(malformed, "en")).toEqual({ title: "Notification" });
  });
});
