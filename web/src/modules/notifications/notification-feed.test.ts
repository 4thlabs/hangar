import { describe, expect, it } from "vitest";
import type { Notification, RecentNotifications } from "#libs/api";
import { NotificationFeed } from "./notification-feed.ts";

function notification(id: number): Notification {
  return {
    id,
    level: "success",
    message: { key: "storeUpdated" },
    href: "/settings",
    seen: false,
    read: false,
    createdAt: "2026-11-26T10:00:00.000Z",
  };
}

function recent(...ids: number[]): RecentNotifications {
  return { epoch: "first", notifications: ids.map(notification) };
}

function ids(feed: RecentNotifications): number[] {
  return feed.notifications.map(item => item.id);
}

describe("NotificationFeed", () => {
  it("puts a new one first, and one it holds once", () => {
    expect(ids(NotificationFeed.add(recent(2, 1), notification(3)))).toEqual([3, 2, 1]);
    expect(ids(NotificationFeed.add(recent(2, 1), notification(2)))).toEqual([2, 1]);
  });

  it("keeps the newest, in the order of their ids", () => {
    const full = recent(...Array.from({ length: NotificationFeed.Size }, (_, index) => NotificationFeed.Size - index));
    const added = NotificationFeed.add(full, notification(NotificationFeed.Size + 1));

    expect(added.notifications).toHaveLength(NotificationFeed.Size);
    expect(ids(added).at(0)).toBe(NotificationFeed.Size + 1);
    expect(ids(added).at(-1)).toBe(2);
  });

  it("drops what it holds when the stream opens in another epoch", () => {
    expect(NotificationFeed.open(recent(2, 1), "first")).toEqual(recent(2, 1));
    expect(NotificationFeed.open(recent(2, 1), "second")).toEqual({ epoch: "second", notifications: [] });
  });

  it("follows the stream from the newest it holds", () => {
    expect(NotificationFeed.since(recent(4, 7))).toBe(7);
    expect(NotificationFeed.since(recent())).toBe(0);
  });

  it("marks those shown seen, and every one read", () => {
    expect(NotificationFeed.seen(recent(2, 1), [1]).notifications.map(item => item.seen)).toEqual([false, true]);
    expect(NotificationFeed.read(recent(1)).notifications.map(item => item.read)).toEqual([true]);
  });
});
