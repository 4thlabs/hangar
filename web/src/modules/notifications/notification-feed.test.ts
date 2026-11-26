import { describe, expect, it } from "vitest";
import type { Notification, RecentNotifications } from "#libs/api";
import { NotificationFeed } from "./notification-feed.ts";

function notification(id: number, dedupeKey: string | null = null): Notification {
  return {
    id,
    level: "success",
    message: { key: "storeUpdated" },
    href: "/settings",
    dedupeKey,
    seen: false,
    read: false,
    createdAt: "2026-11-26T10:00:00.000Z",
  };
}

function recent(...ids: number[]): RecentNotifications {
  return { epoch: "first", notifications: ids.map(id => notification(id)) };
}

function ids(feed: RecentNotifications): number[] {
  return feed.notifications.map(item => item.id);
}

describe("NotificationFeed", () => {
  it("puts a new one first, and one it holds once", () => {
    expect(ids(NotificationFeed.add(recent(2, 1), notification(3)))).toEqual([3, 2, 1]);
    expect(ids(NotificationFeed.add(recent(2, 1), notification(2)))).toEqual([2, 1]);
  });

  it("puts a new one in place of the older one of its dedupe key, as the server did", () => {
    const held = { epoch: "first", notifications: [notification(2), notification(1, "backup:alpha")] };

    expect(ids(NotificationFeed.add(held, notification(3, "backup:alpha")))).toEqual([3, 2]);
    expect(ids(NotificationFeed.add(held, notification(3, "backup:beta")))).toEqual([3, 2, 1]);
  });

  it("passes over an older one of a dedupe key it holds a newer one of", () => {
    const held = { epoch: "first", notifications: [notification(5, "backup:alpha")] };

    expect(ids(NotificationFeed.add(held, notification(3, "backup:alpha")))).toEqual([5]);
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
