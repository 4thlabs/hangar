import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
  getNotificationsEventsUrl,
  getNotificationsListQueryKey,
  ServerEvents,
  useNotificationsList,
  useNotificationsRead,
  useNotificationsSeen,
  type NotificationEvent,
  type RecentNotifications,
} from "#libs/api";
import { toast } from "#modules/common/ui/toast.tsx";
import { NotificationFeed } from "#modules/notifications/notification-feed.ts";
import { NotificationText } from "#modules/notifications/notification-text.ts";

/** How the notifications are shown as they come. */
class NotificationToasts {
  /** How many unseen notifications may toast at once; the rest wait in the bell. */
  static readonly Limit = 3;

  /** What tells one notification from another, in every epoch. */
  static key(epoch: string, id: number): string {
    return `${epoch}:${id}`;
  }
}

/** The list the page holds, in its query's cache. */
class NotificationCache {
  /**
   * Changes the list the page holds by `change`, once a read of it in flight is cancelled: its answer, read before the
   * change, would put back what the change took out.
   */
  static async change(queryClient: QueryClient, change: (recent: RecentNotifications) => RecentNotifications) {
    const queryKey = getNotificationsListQueryKey();

    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<RecentNotifications>(queryKey, recent => recent && change(recent));
  }
}

/**
 * The notifications of the bell: the server's newest, then each one filed, pushed by the server. Each page open shows a
 * new one as a toast, which marks it seen, so that a page opened after does not; it counts as unread until the list is
 * read, for every user.
 *
 * The stream is opened once the list is read, from the newest it holds, so that what was filed in between comes first;
 * opened again once lost, it gives those again, which the list holds once. A stream that opens in another epoch of ids,
 * as after the server lost its file, empties the list, and gives every one the server keeps.
 *
 * @returns The list, the newest first, how many are unread, and what marks them all read.
 */
export function useNotifications() {
  const queryClient = useQueryClient();
  const { data, isSuccess } = useNotificationsList();
  // A mark that fails leaves the page's list as it marked it, not as the server holds it: the list is read again.
  const onError = () => void queryClient.invalidateQueries({ queryKey: getNotificationsListQueryKey() });
  const { mutate: markSeen } = useNotificationsSeen({ mutation: { onError } });
  // Kept alive, as the bell is read when a notification's link is followed too, which unloads the page.
  const { mutate: markRead } = useNotificationsRead({ mutation: { onError }, request: { keepalive: true } });
  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const epoch = data?.epoch;

  // What this page toasted. `seen` covers a page opened after; this covers the renders in between, where the mark has
  // not made the round trip yet.
  const toasted = useRef(new Set<string>());

  useEffect(() => {
    const held = queryClient.getQueryData<RecentNotifications>(getNotificationsListQueryKey());

    if (!isSuccess || held === undefined) {
      return;
    }

    // One change at a time, in the order of the stream.
    let changes = Promise.resolve();

    const follow = (event: NotificationEvent) => {
      changes = changes.then(() =>
        NotificationCache.change(queryClient, recent =>
          event.kind === "opened"
            ? NotificationFeed.open(recent, event.epoch)
            : NotificationFeed.add(recent, event.notification),
        ),
      );
    };

    const url = getNotificationsEventsUrl({ since: NotificationFeed.since(held), epoch: held.epoch });

    return ServerEvents.keep<NotificationEvent>(url, { onItem: follow });
  }, [isSuccess, queryClient]);

  useEffect(() => {
    if (epoch === undefined) {
      return;
    }

    const pending = notifications.filter(
      item => !item.seen && !toasted.current.has(NotificationToasts.key(epoch, item.id)),
    );

    if (pending.length === 0) {
      return;
    }

    const ids = pending.map(item => item.id);

    for (const id of ids) {
      toasted.current.add(NotificationToasts.key(epoch, id));
    }

    for (const item of pending.slice(0, NotificationToasts.Limit)) {
      toast.add({ ...NotificationText.describe(item.message), type: item.level });
    }

    // Every one of them, not just those toasted: the others were withheld, and showing them at the next page load
    // would be stale news.
    void NotificationCache.change(queryClient, recent => NotificationFeed.seen(recent, ids));
    markSeen({ data: { ids } });
  }, [epoch, notifications, markSeen, queryClient]);

  const unread = notifications.filter(item => !item.read).length;

  const readAll = () => {
    if (unread === 0) {
      return;
    }

    void NotificationCache.change(queryClient, NotificationFeed.read);
    markRead();
  };

  return { notifications, unread, readAll };
}
