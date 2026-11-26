import type { QueryClient } from "@tanstack/react-query";
import {
  getNotificationsListQueryKey,
  getNotificationsListQueryOptions,
  getNotificationsReadMutationOptions,
  getNotificationsSeenMutationOptions,
  type RecentNotifications,
} from "#libs/api";
import { withRead, withSeen } from "#modules/notifications/helpers/notification-feed.ts";

/** The reads of the bell. */
export const notificationsQueries = {
  /** The server's newest notifications, which the stream then keeps up to date in the cache. */
  list: () => getNotificationsListQueryOptions(),
};

/**
 * Changes the list the page holds, in its query's cache, by `change`, once a read of it in flight is cancelled: its
 * answer, read before the change, would put back what the change took out. The stream and the marks write through it.
 */
export async function changeNotifications(
  client: QueryClient,
  change: (recent: RecentNotifications) => RecentNotifications,
): Promise<void> {
  const queryKey = getNotificationsListQueryKey();

  await client.cancelQueries({ queryKey });
  client.setQueryData<RecentNotifications>(queryKey, recent => recent && change(recent));
}

/**
 * A mark that fails leaves the page's list as it marked it, not as the server holds it: the list is read again, rather
 * than a copy put back, which would drop what the stream brought meanwhile.
 */
function readAgain(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: getNotificationsListQueryKey() });
}

/**
 * The marks of the bell, optimistic (ADR 0002, decision 12): written in the cache before the call is sent, as the
 * server cannot refuse them for a reason the page cannot see, and their answer carries nothing. A success reads
 * nothing again: the stream keeps the list.
 */
export const notificationsMutations = {
  /** Marks `ids` seen: toasted, or withheld, so that a page opened after does not toast them. */
  markSeen: () =>
    getNotificationsSeenMutationOptions({
      mutation: {
        onMutate: ({ data }, { client }) => changeNotifications(client, recent => withSeen(recent, data.ids)),
        onError: (_error, _variables, _onMutateResult, { client }) => readAgain(client),
      },
    }),
  /** Marks every one read. Kept alive, as the bell is read when a notification's link is followed, which unloads the page. */
  readAll: () =>
    getNotificationsReadMutationOptions({
      mutation: {
        onMutate: (_variables, { client }) => changeNotifications(client, withRead),
        onError: (_error, _variables, _onMutateResult, { client }) => readAgain(client),
      },
      request: { keepalive: true },
    }),
};
