import { setTimeout as delay } from "node:timers/promises";
import { apiRoute, sseEvent, sseStream } from "#app/api/api-route.ts";
import { notifications } from "#libs/notifications/server";

/**
 * How often the stream looks for new notifications.
 * ponytail: polling the same SQLite rather than a pub/sub bus, because a Sidequest job writes
 * from another process where an in-memory emitter would never be heard. Swap it for a real bus
 * the day the delay is felt.
 */
const INTERVAL = 3_000;

async function* frames(userId: string, from: Date, signal: AbortSignal) {
  let cursor = from;

  // The cursor is a millisecond and several notifications can share one, so the query bound is
  // inclusive and these are the ids already sent at that exact millisecond. Without them the
  // last notification of every batch would be re-sent on every tick, forever.
  const alreadySent = new Set<string>();

  try {
    for (;;) {
      await delay(INTERVAL, undefined, { signal });

      const fresh = (await notifications.since(userId, cursor)).filter(item => !alreadySent.has(item.id));
      const newest = fresh.at(-1)?.createdAt;

      if (newest === undefined) continue;

      if (newest !== cursor.getTime()) alreadySent.clear();
      for (const item of fresh) if (item.createdAt === newest) alreadySent.add(item.id);
      cursor = new Date(newest);

      yield sseEvent(fresh);
    }
  } catch {
    // The client went away, or the database did. Ending the stream is all that is left: the
    // status line is long gone, so the browser reconnects and gets the error then.
  }
}

/**
 * The signed-in user's notifications as they are filed, as Server-Sent Events.
 * @param since Epoch milliseconds of the newest notification the client already holds
 */
export const GET = apiRoute(
  { log: "Failed to stream notifications", unavailable: "Les notifications sont indisponibles." },
  async (request, _context, session) => {
    const since = Number(new URL(request.url).searchParams.get("since"));
    const from = new Date(Number.isFinite(since) && since > 0 ? since : Date.now());

    return sseStream(frames(session.user.id, from, request.signal));
  },
);
