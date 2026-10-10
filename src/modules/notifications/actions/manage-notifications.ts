"use server";

import { sessions } from "#libs/auth/server";
import { notifications } from "#libs/notifications/server";

/** Records that notifications were toasted. Not via `useServerAction`: toasting that a toast was shown helps nobody. */
export async function markNotificationsSeen(ids: string[]): Promise<void> {
  const { user } = await sessions.require();

  await notifications.markSeen(user.id, ids);
}

/** Clears the bell's badge: marks every unread notification read. */
export async function markNotificationsRead(): Promise<void> {
  const { user } = await sessions.require();

  await notifications.markRead(user.id);
}
