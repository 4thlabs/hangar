import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
  getNotificationsEventsUrl,
  getNotificationsListQueryKey,
  ServerEvents,
  useNotificationsList,
  useNotificationsRead,
  useNotificationsSeen,
  type Notification,
} from "#libs/api";
import { toast } from "#modules/common/ui/toast.tsx";
import { NotificationFeed } from "#modules/notifications/notification-feed.ts";
import { NotificationText } from "#modules/notifications/notification-text.ts";

/** How the notifications are shown as they come. */
class NotificationToasts {
  /** How many unseen notifications may toast at once; the rest wait in the bell. */
  static readonly Limit = 3;
}

/**
 * The notifications of the bell: the server's newest, then each one filed, pushed by the server. A new one is shown as
 * a toast, once, which marks it seen for every page; it counts as unread until the list is read, for every user.
 *
 * The stream is opened once the list is read, from the newest it holds, so that what was filed in between comes first;
 * opened again once lost, it gives those again, which the list holds once.
 *
 * @returns The list, the newest first, how many are unread, and what marks them all read.
 */
export function useNotifications() {
  const queryClient = useQueryClient();
  const { data, isSuccess } = useNotificationsList();
  const { mutate: markSeen } = useNotificationsSeen();
  const { mutate: markRead } = useNotificationsRead();
  const notifications = useMemo(() => data ?? [], [data]);

  // Ids already toasted in this tab. `seen` covers coming back to the page; this covers the renders in between, where
  // the mark has not made the round trip yet.
  const toasted = useRef(new Set<number>());

  useEffect(() => {
    if (!isSuccess) {
      return;
    }

    const queryKey = getNotificationsListQueryKey();
    const since = NotificationFeed.since(queryClient.getQueryData<Notification[]>(queryKey) ?? []);

    return ServerEvents.keep<Notification>(getNotificationsEventsUrl({ since }), {
      onItem: notification =>
        queryClient.setQueryData<Notification[]>(queryKey, list => NotificationFeed.add(list ?? [], notification)),
    });
  }, [isSuccess, queryClient]);

  useEffect(() => {
    const pending = notifications.filter(item => !item.seen && !toasted.current.has(item.id));

    if (pending.length === 0) {
      return;
    }

    for (const item of pending) {
      toasted.current.add(item.id);
    }

    for (const item of pending.slice(0, NotificationToasts.Limit)) {
      toast.add({ ...NotificationText.describe(item.message), type: item.level });
    }

    // Every one of them, not just those toasted: the others were withheld, and showing them at the next page load
    // would be stale news.
    markSeen({ data: { ids: pending.map(item => item.id) } });
  }, [notifications, markSeen]);

  const unread = notifications.filter(item => !item.read).length;

  const readAll = () => {
    if (unread === 0) {
      return;
    }

    queryClient.setQueryData<Notification[]>(getNotificationsListQueryKey(), list => NotificationFeed.read(list ?? []));
    markRead();
  };

  return { notifications, unread, readAll };
}
