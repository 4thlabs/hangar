import type { Notification, RecentNotifications } from "#libs/api";

/**
 * The list the bell shows: the server's newest, the newest first, and those its stream brings, each once, all of one
 * epoch of ids.
 */
export class NotificationFeed {
  /** How many the list holds, as many as the server gives at first. */
  static readonly Size = 30;

  /** `recent` with `notification`, unless it holds it already, as a stream opened again gives it again. */
  static add(recent: RecentNotifications, notification: Notification): RecentNotifications {
    if (recent.notifications.some(item => item.id === notification.id)) {
      return recent;
    }

    const notifications = [notification, ...recent.notifications]
      .sort((left, right) => right.id - left.id)
      .slice(0, NotificationFeed.Size);

    return { ...recent, notifications };
  }

  /**
   * `recent` as a stream opened in `epoch` finds it: unchanged in its own epoch, empty in another, whose ids say
   * nothing of the server's, as the stream then gives every one it keeps.
   */
  static open(recent: RecentNotifications, epoch: string): RecentNotifications {
    return recent.epoch === epoch ? recent : { epoch, notifications: [] };
  }

  /**
   * The id the stream is followed from: that of the newest of `recent`, or 0 when it holds none, as every one the
   * server holds then was filed after the list was read.
   */
  static since(recent: RecentNotifications): number {
    return recent.notifications.reduce((newest, item) => Math.max(newest, item.id), 0);
  }

  /** `recent`, those of `ids` seen. */
  static seen(recent: RecentNotifications, ids: readonly number[]): RecentNotifications {
    const notifications = recent.notifications.map(item => (ids.includes(item.id) ? { ...item, seen: true } : item));

    return { ...recent, notifications };
  }

  /** `recent`, every one read. */
  static read(recent: RecentNotifications): RecentNotifications {
    return { ...recent, notifications: recent.notifications.map(item => ({ ...item, read: true })) };
  }
}
