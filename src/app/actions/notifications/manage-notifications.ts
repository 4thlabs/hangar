"use server";

import { ActionResult } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { notifications } from "#libs/notifications/server";

/**
 * Records that notifications have been shown as a toast. Called straight from the client rather
 * than through `useServerAction`: toasting the fact that a toast was shown helps nobody.
 */
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
