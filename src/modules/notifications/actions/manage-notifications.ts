"use server";

import { ActionResult } from "#modules/common/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { notifications } from "#libs/notifications/server";

/** Records that notifications were toasted. Not via `useServerAction`: toasting that a toast was shown helps nobody. */
export async function markNotificationsSeen(ids: string[]): Promise<ActionResult> {
  const { user } = await requireSession();
  await notifications.markSeen(user.id, ids);

  return ActionResult.success("Notifications marquées comme affichées.");
}

/** Clears the bell's badge, for the given notifications or for every unread one. */
export async function markNotificationsRead(ids?: string[]): Promise<ActionResult> {
  const { user } = await requireSession();
  await notifications.markRead(user.id, ids);

  return ActionResult.success("Notifications marquées comme lues.");
}
