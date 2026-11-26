import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification, NotificationMessage, RecentNotifications } from "#libs/api";
import { FakeEventSource, renderAt, serve, type Answers } from "#app/mock/page.tsx";

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

/** The list of the epoch `first`: one unseen, the update that failed, and one seen and read. */
const recent: RecentNotifications = {
  epoch: "first",
  notifications: [
    notification(2, { key: "storeUpdateFailed" }, { level: "error" }),
    notification(1, { key: "storeInstalled" }, { seen: true, read: true }),
  ],
};

/** The server's answers to the bell, the list being `list`, and an empty `/apps` around it. */
function answers(list: () => Response | Promise<Response>): Answers {
  return {
    "GET /api/docker/apps": () => Response.json([]),
    "GET /api/notifications": list,
    "POST /api/notifications/seen": () => new Response(null, { status: 204 }),
    "POST /api/notifications/read": () => new Response(null, { status: 204 }),
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
  focusManager.setFocused(undefined);
});

describe("the notifications' bell", () => {
  it("toasts the unseen once, follows the stream from the newest, and reads them all on close", async () => {
    const fetch = serve(answers(() => Response.json(recent)));

    renderAt("/apps");

    expect(await screen.findByText("The update of the store failed. See the server's log.")).toBeDefined();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/notifications/seen", expect.objectContaining({ body: '{"ids":[2]}' })),
    );

    const stream = await source("/api/notifications/events?since=2&epoch=first");

    stream.open();
    stream.send({ kind: "opened", epoch: "first" });
    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });
    // Given again, as a stream opened again does: the list holds it once.
    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });

    expect(await screen.findByText("The store was updated.")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));

    expect(await screen.findByText("Store: installation finished")).toBeDefined();
    expect(screen.getAllByText("Store: update finished")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/notifications/read", expect.objectContaining({ method: "POST" })),
    );

    expect(screen.getByRole("button", { name: "Notifications" })).toBeDefined();
  });

  it("keeps what the stream brought over a read of the list that was in flight", async () => {
    let reads = 0;
    let answerLate: (response: Response) => void = () => {};

    serve(
      answers(() => {
        reads += 1;

        return reads === 1 ? Response.json(recent) : new Promise<Response>(resolve => (answerLate = resolve));
      }),
    );

    renderAt("/apps");

    const stream = await source("/api/notifications/events?since=2&epoch=first");

    // The tab comes back: the list is read again, and its answer, read before what the stream brings, comes after.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(reads).toBe(2));

    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });

    expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeDefined();

    // Answered, then a tick, in which the query client hands its answer to the page.
    await act(async () => {
      answerLate(Response.json(recent));
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeDefined();
  });

  it("drops the list it holds when the stream opens in another epoch, and shows the server's", async () => {
    serve(answers(() => Response.json({ epoch: "first", notifications: [recent.notifications[1]] })));
    renderAt("/apps");

    const stream = await source("/api/notifications/events?since=1&epoch=first");

    stream.send({ kind: "opened", epoch: "second" });
    // Id 1 again, but of the new epoch: a notification of its own.
    stream.send({ kind: "filed", notification: notification(1, { key: "storeUpdated" }, { createdAt: "garbage" }) });

    expect(await screen.findByText("The store was updated.")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    expect(await screen.findByText("at an unknown time")).toBeDefined();
    expect(screen.queryByText("Store: installation finished")).toBeNull();
  });
});
