import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification, NotificationMessage } from "#libs/api";
import { FakeEventSource, renderAt, serve } from "#app/mock/page.tsx";

/** A notification of the store, `id`, neither seen nor read unless `marks` says so. */
function notification(id: number, message: NotificationMessage, marks: Partial<Notification> = {}): Notification {
  return {
    id,
    level: "success",
    message,
    href: "/settings",
    seen: false,
    read: false,
    createdAt: new Date().toISOString(),
    ...marks,
  };
}

/** The source of `url` the page holds open, once it does. */
async function source(url: string): Promise<FakeEventSource> {
  let found: FakeEventSource | undefined;

  await waitFor(() => {
    found = FakeEventSource.of(url);
    expect(found).toBeDefined();
  });

  return found as FakeEventSource;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the notifications' bell", () => {
  it("toasts the unseen once, follows the stream from the newest, and reads them all on close", async () => {
    const fetch = serve({
      "GET /api/docker/apps": () => Response.json([]),
      "GET /api/notifications": () =>
        Response.json([
          notification(2, { key: "storeUpdateFailed" }, { level: "error" }),
          notification(1, { key: "storeInstalled" }, { seen: true, read: true }),
        ]),
      "POST /api/notifications/seen": () => new Response(null, { status: 204 }),
      "POST /api/notifications/read": () => new Response(null, { status: 204 }),
    });

    renderAt("/apps");

    expect(await screen.findByText("The update of the store failed. See the server's log.")).toBeDefined();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/notifications/seen", expect.objectContaining({ body: '{"ids":[2]}' })),
    );

    const stream = await source("/api/notifications/events?since=2");

    stream.open();
    stream.send(notification(3, { key: "storeUpdated" }));
    // Given again, as a stream opened again does: the list holds it once.
    stream.send(notification(3, { key: "storeUpdated" }));

    expect(await screen.findByText("The store was updated.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    expect(await screen.findByText("Store: installation finished")).toBeDefined();
    expect(screen.getAllByText("Store: update finished")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/notifications/read", expect.objectContaining({ method: "POST" })),
    );

    expect(screen.getByRole("button", { name: "Notifications" })).toBeDefined();
  });
});
