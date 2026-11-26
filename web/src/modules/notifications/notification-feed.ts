import type { Notification } from "#libs/api";

/** The list the bell shows: the server's newest, the newest first, and those its stream brings, each once. */
export class NotificationFeed {
  /** How many the list holds, as many as the server gives at first. */
  static readonly Size = 30;

  /** `list` with `notification`, unless it holds it already, as a stream opened again gives it again. */
  static add(list: readonly Notification[], notification: Notification): Notification[] {
    if (list.some(item => item.id === notification.id)) {
      return [...list];
    }

    return [notification, ...list].sort((left, right) => right.id - left.id).slice(0, NotificationFeed.Size);
  }

  /**
   * The id the stream is followed from: that of the newest of `list`, or 0 for an empty list, as every one the server
   * holds then was filed after the list was read.
   */
  static since(list: readonly Notification[]): number {
    return list.reduce((newest, item) => Math.max(newest, item.id), 0);
  }

  /** `list`, every one read. */
  static read(list: readonly Notification[]): Notification[] {
    return list.map(item => ({ ...item, read: true }));
  }
}
