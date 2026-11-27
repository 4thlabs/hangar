import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Notification,
  NotificationEvent,
  NotificationMessage,
  RecentNotifications,
  SeenNotifications,
} from "#libs/api";
import {
  getComposeBatchesMockHandler,
  getDockerProjectsMockHandler,
  getNotificationsListMockHandler,
  getNotificationsReadMockHandler,
  getNotificationsSeenMockHandler,
} from "#libs/api/mock";
import { countCalls, feed, network, problem } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

/** A notification of the store, `id`, neither seen nor read unless `marks` says so. */
function notification(id: number, message: NotificationMessage, marks: Partial<Notification> = {}): Notification {
  return {
    id,
    level: "success",
    message,
    href: "/settings",
    dedupeKey: null,
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

/**
 * What the bell calls, the list being `list`, its marks recorded in `seen`, and an empty `/apps` around it: its
 * stream, `stream`, the test sends on.
 */
function bell(list: () => RecentNotifications | Promise<RecentNotifications>) {
  const stream = feed<NotificationEvent>("/api/notifications/events");
  const seen: SeenNotifications[] = [];

  network.use(
    getNotificationsListMockHandler(list),
    getNotificationsSeenMockHandler(async ({ request }) => {
      seen.push(await request.json());
    }),
    getNotificationsReadMockHandler(),
    stream.handler,
    getDockerProjectsMockHandler([]),
    getComposeBatchesMockHandler([]),
    feed("/api/docker/changes").handler,
  );

  return { stream, seen };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

describe("the notifications' bell", () => {
  it("writes the times of the open panel from the clock, which goes on while the panel stays open", async () => {
    const filedAt = Date.UTC(2026, 10, 26, 8, 0, 0);
    const createdAt = new Date(filedAt).toISOString();
    const filed = notification(1, { key: "storeInstalled" }, { seen: true, read: true, createdAt });

    vi.useFakeTimers({ now: filedAt + 5 * 60_000, toFake: ["Date", "setInterval", "clearInterval"] });
    bell(() => ({ epoch: "first", notifications: [filed] }));
    renderAt("/apps");
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("5 minutes ago")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });

    expect(screen.getByText("1 hour ago")).toBeDefined();
  });

  it("toasts the unseen once, follows the stream from the newest, and reads them all on close", async () => {
    const calls = countCalls();
    const { stream, seen } = bell(() => recent);

    renderAt("/apps");

    expect(await screen.findByText("The update of the store failed. See the server's log.")).toBeDefined();
    await waitFor(() => expect(seen).toEqual([{ ids: [2] }]));
    await waitFor(() => expect(stream.urls).toEqual(["/api/notifications/events?since=2&epoch=first"]));

    stream.send({ kind: "opened", epoch: "first" });
    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });
    // Given again, as a stream opened again does: the list holds it once.
    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });

    expect(await screen.findByText("The store was updated.")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));

    expect(await screen.findByText("Store: installation finished")).toBeDefined();
    expect(screen.getAllByText("Store: update finished")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));

    await waitFor(() => expect(calls("POST /api/notifications/read")).toBe(1));

    expect(screen.getByRole("button", { name: "Notifications" })).toBeDefined();
  });

  it("reads the list when a notification's link is followed, by a call that outlives the page", async () => {
    // msw's request loses `keepalive`: the call is read where the page makes it.
    const fetch = vi.spyOn(globalThis, "fetch");

    bell(() => recent);
    renderAt("/apps");
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(await screen.findByRole("link", { name: /Store: installation finished/ }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications/read",
        expect.objectContaining({ method: "POST", keepalive: true }),
      ),
    );
  });

  it("reads the list again when marking it read fails, so that the bell says what the server holds", async () => {
    let reads = 0;

    bell(() => {
      reads += 1;

      return recent;
    });

    network.use(
      getNotificationsReadMockHandler(() => {
        throw problem(503, "unavailable");
      }),
    );

    renderAt("/apps");

    const button = await screen.findByRole("button", { name: "Notifications, 1 unread" });

    fireEvent.click(button);
    await screen.findByText("Store: installation finished");
    fireEvent.click(button);

    await waitFor(() => expect(reads).toBe(2));

    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeDefined();
  });

  it("shows the list read as the bell closes, before the server answers, and reads nothing again once it does", async () => {
    let answerRead: () => void = () => {};
    const calls = countCalls();

    bell(() => recent);
    network.use(getNotificationsReadMockHandler(() => new Promise<void>(resolve => (answerRead = resolve))));

    const { queryClient } = renderAt("/apps").options.context;
    const button = await screen.findByRole("button", { name: "Notifications, 1 unread" });

    fireEvent.click(button);
    await screen.findByText("Store: installation finished");
    fireEvent.click(button);

    // The mark is sent, and not answered yet: the bell already says the list is read.
    await waitFor(() => expect(calls("POST /api/notifications/read")).toBe(1));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeDefined();

    // Answered: once the mark has settled, and its callbacks have run, a read of the list would have started. The
    // stream keeps the list, so none does.
    answerRead();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await act(() => Promise.resolve());

    expect(calls("GET /api/notifications")).toBe(1);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeDefined();
  });

  it("keeps unread what the stream brings while the list is being marked read", async () => {
    let answerRead: () => void = () => {};
    const calls = countCalls();
    const { stream } = bell(() => recent);

    network.use(getNotificationsReadMockHandler(() => new Promise<void>(resolve => (answerRead = resolve))));

    const { queryClient } = renderAt("/apps").options.context;

    await waitFor(() => expect(stream.urls).toEqual(["/api/notifications/events?since=2&epoch=first"]));

    const button = await screen.findByRole("button", { name: "Notifications, 1 unread" });

    fireEvent.click(button);
    await screen.findByText("Store: installation finished");
    fireEvent.click(button);
    await waitFor(() => expect(calls("POST /api/notifications/read")).toBe(1));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeDefined();

    // Filed while the mark waits for its answer: after the mark, so not read by it.
    stream.send({ kind: "filed", notification: notification(3, { key: "storeUpdated" }) });

    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeDefined();

    answerRead();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await act(() => Promise.resolve());

    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeDefined();
  });

  it("keeps what the stream brought over a read of the list that was in flight", async () => {
    let reads = 0;
    let answerLate: (list: RecentNotifications) => void = () => {};

    const { stream } = bell(() => {
      reads += 1;

      return reads === 1 ? recent : new Promise<RecentNotifications>(resolve => (answerLate = resolve));
    });

    renderAt("/apps");
    await waitFor(() => expect(stream.urls).toEqual(["/api/notifications/events?since=2&epoch=first"]));

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
      answerLate(recent);
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeDefined();
  });

  it("drops the list it holds when the stream opens in another epoch, and shows the server's", async () => {
    const seenAndRead = notification(1, { key: "storeInstalled" }, { seen: true, read: true });
    const { stream } = bell(() => ({ epoch: "first", notifications: [seenAndRead] }));

    renderAt("/apps");
    await waitFor(() => expect(stream.urls).toEqual(["/api/notifications/events?since=1&epoch=first"]));

    stream.send({ kind: "opened", epoch: "second" });
    // Id 1 again, but of the new epoch: a notification of its own.
    stream.send({ kind: "filed", notification: notification(1, { key: "storeUpdated" }, { createdAt: "garbage" }) });

    expect(await screen.findByText("The store was updated.")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    expect(await screen.findByText("at an unknown time")).toBeDefined();
    expect(screen.queryByText("Store: installation finished")).toBeNull();
  });
});
