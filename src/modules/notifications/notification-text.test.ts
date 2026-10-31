import { describe, expect, it } from "vitest";
import type { NotificationPayload } from "#libs/notifications";
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
  it("files a key and its parameters, in no language", () => {
    expect(NotificationText.create("updatesAvailable", { count: 2 })).toEqual({
      key: "updatesAvailable",
      params: { count: 2 },
    });

    expect(NotificationText.create("storeInstalled")).toEqual({ key: "storeInstalled", params: {} });
  });

  it("renders the same notification in each language", () => {
    const notification = payload({ message: NotificationText.create("updatesAvailable", { count: 1 }) });

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
    const message = NotificationText.create("composeSucceeded", { project: "whoami", operation: "up", flags: "pull" });

    expect(NotificationText.render(payload({ message }), "en")).toEqual({
      title: "Update finished",
      description: "whoami was updated from its registry.",
    });
  });

  it("shows a row filed before messages as it was stored", () => {
    const legacy = payload({ title: "Sauvegarde échouée", description: "Disque plein" });

    expect(NotificationText.render(legacy, "en")).toEqual({ title: "Sauvegarde échouée", description: "Disque plein" });
  });

  it("falls back on the stored words for a key the catalog no longer has", () => {
    const dropped = payload({ title: "gone", message: { key: "gone", params: {} } });

    expect(NotificationText.render(dropped, "fr")).toEqual({ title: "gone" });
  });
});
