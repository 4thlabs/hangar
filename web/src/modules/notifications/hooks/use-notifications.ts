import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getNotificationsEventsUrl, type NotificationEvent } from "#libs/api";
import { useEventFeed } from "#modules/common/hooks/use-event-feed.ts";
import { toast } from "#modules/common/ui/toast.tsx";
import {
  changeNotifications,
  notificationsMutations,
  notificationsQueries,
} from "#modules/notifications/api/notifications-queries.ts";
import { newestId, openedIn, withNotification } from "#modules/notifications/helpers/notification-feed.ts";
import { describeNotification } from "#modules/notifications/helpers/notification-text.ts";

/** How many unseen notifications may toast at once, as they come; the rest wait in the bell. */
const toastLimit = 3;

/** What tells one notification from another, in every epoch. */
function toastKey(epoch: string, id: number): string {
  return `${epoch}:${id}`;
}

/**
 * The notifications of the bell: the server's newest, then each one filed, pushed by the server. Each page open shows a
 * new one as a toast, which marks it seen, so that a page opened after does not; it counts as unread until the list is
 * read, for every user.
 *
 * The feed is opened once the list is read, from the newest it holds, so that what was filed in between comes first;
 * opened again once lost, it gives those again, which the list holds once. A feed that opens in another epoch of ids,
 * as after the server lost its file, empties the list, and gives every one the server keeps.
 *
 * @returns The list, the newest first, how many are unread, and what marks them all read.
 */
export function useNotifications() {
  const queryClient = useQueryClient();
  const { data } = useQuery(notificationsQueries.list());
  const { mutate: markSeen } = useMutation(notificationsMutations.markSeen());
  const { mutate: markRead } = useMutation(notificationsMutations.readAll());
  // The same list from render to render while the cache's is, as the effect below lists it.
  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const epoch = data?.epoch;

  // The feed's URL, from the first list read, once: the list is then the feed's, and a URL from a later one would
  // connect again for nothing.
  const [url, setUrl] = useState<string | null>(null);

  if (url === null && data !== undefined) {
    setUrl(getNotificationsEventsUrl({ since: newestId(data), epoch: data.epoch }));
  }

  // One change at a time, in the order of the feed.
  const changes = useRef(Promise.resolve());

  useEventFeed<NotificationEvent>(url, {
    onItem: event => {
      changes.current = changes.current.then(() =>
        changeNotifications(queryClient, recent =>
          event.kind === "opened" ? openedIn(recent, event.epoch) : withNotification(recent, event.notification),
        ),
      );
    },
  });

  // What this page toasted. `seen` covers a page opened after; this covers the renders in between, where the mark has
  // not made the round trip yet.
  const toasted = useRef(new Set<string>());

  useEffect(() => {
    if (epoch === undefined) {
      return;
    }

    const pending = notifications.filter(item => !item.seen && !toasted.current.has(toastKey(epoch, item.id)));

    if (pending.length === 0) {
      return;
    }

    const ids = pending.map(item => item.id);

    for (const id of ids) {
      toasted.current.add(toastKey(epoch, id));
    }

    for (const item of pending.slice(0, toastLimit)) {
      toast.add({ ...describeNotification(item.message), type: item.level });
    }

    // Every one of them, not just those toasted: the others were withheld, and showing them at the next page load
    // would be stale news.
    markSeen({ data: { ids } });
  }, [epoch, notifications, markSeen]);

  const unread = notifications.filter(item => !item.read).length;

  const readAll = () => {
    if (unread > 0) {
      markRead();
    }
  };

  return { notifications, unread, readAll };
}
