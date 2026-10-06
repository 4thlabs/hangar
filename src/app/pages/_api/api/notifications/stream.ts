import { setTimeout as delay } from "node:timers/promises";
import { imageCheckReport } from "#libs/jobs";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";
import { apiRoute, sseEvent, sseStream } from "#app/api/api-route.ts";

/**
 * Polls SQLite: jobs write from another process, where an in-memory emitter would never be heard.
 * ponytail: swap for a real pub/sub bus the day the delay is felt.
 */
const INTERVAL = 3_000;

async function* frames(userId: string, from: Date, signal: AbortSignal) {
  let cursor = from;

  // The cursor bound is inclusive and notifications can share a millisecond: these ids were already sent at
  // that millisecond, or the last of every batch would be re-sent on every tick.
  const alreadySent = new Set<string>();

  try {
    for (;;) {
      await delay(INTERVAL, undefined, { signal });

      const fresh = (await notifications.since(userId, cursor)).filter(item => !alreadySent.has(item.id));
      const newest = fresh.at(-1)?.createdAt;

      if (newest === undefined) {
        continue;
      }

      if (newest !== cursor.getTime()) {
        alreadySent.clear();
      }

      for (const item of fresh) {
        if (item.createdAt === newest) {
          alreadySent.add(item.id);
        }
      }

      cursor = new Date(newest);

      // A notification may mean a job finished: refresh the image report first, since the client reloads on it.
      await imageCheckReport.refresh();

      yield sseEvent(fresh);
    }
  } catch (error) {
    // Client gone (normal, not logged) or database failed; the browser reconnects and gets the error.
    if (!signal.aborted) {
      logger.warn("Notification stream failed", { error, userId });
    }
  }
}

/** The signed-in user's notifications over SSE, from `?since=` (epoch ms of the newest one the client holds). */
export const GET = apiRoute(
  { log: "Failed to stream notifications", unavailable: "Les notifications sont indisponibles." },
  async (request, _context, session) => {
    const since = Number(new URL(request.url).searchParams.get("since"));
    const from = new Date(Number.isFinite(since) && since > 0 ? since : Date.now());

    return sseStream(frames(session.user.id, from, request.signal));
  },
);
