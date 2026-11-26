import { describe, expect, it } from "vitest";
import type { Notification } from "#libs/api";
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

describe("NotificationFeed", () => {
  it("puts a new one first, and one it holds once", () => {
    const list = [notification(2), notification(1)];

    expect(NotificationFeed.add(list, notification(3)).map(item => item.id)).toEqual([3, 2, 1]);
    expect(NotificationFeed.add(list, notification(2)).map(item => item.id)).toEqual([2, 1]);
  });

  it("keeps the newest, in the order of their ids", () => {
    const full = Array.from({ length: NotificationFeed.Size }, (_, index) =>
      notification(NotificationFeed.Size - index),
    );

    const added = NotificationFeed.add(full, notification(NotificationFeed.Size + 1));

    expect(added).toHaveLength(NotificationFeed.Size);
    expect(added.at(0)?.id).toBe(NotificationFeed.Size + 1);
    expect(added.at(-1)?.id).toBe(2);
  });

  it("follows the stream from the newest it holds", () => {
    expect(NotificationFeed.since([notification(4), notification(7)])).toBe(7);
    expect(NotificationFeed.since([])).toBe(0);
  });

  it("reads every one", () => {
    expect(NotificationFeed.read([notification(1)]).map(item => item.read)).toEqual([true]);
  });
});
