import { setTimeout as delay } from "node:timers/promises";
import { apiRoute, sseEvent, sseStream } from "#app/api/api-route.ts";
import type { Samples } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { ContainerStats } from "#libs/docker";

/** How often a frame goes out. Also the window the CPU percentage is measured over. */
const INTERVAL = 1_000;

/** One event, carrying every container's metrics; CPU is the delta from `previous`. */
function frame(current: Samples, previous: Samples) {
  const metrics = [...current].map(([id, raw]) => [id, new ContainerStats(raw, previous.get(id)).metrics()]);

  return sseEvent(Object.fromEntries(metrics));
}

/**
 * Each connection keeps its own previous sample: a CPU percentage is a delta between two reads,
 * and one-shot samples cost ~2ms apiece, so there is nothing worth sharing between connections.
 * @param first The sample taken before the response, so a dead daemon is a 503 and not an empty stream
 */
async function* frames(first: Samples, signal: AbortSignal) {
  let previous: Samples = new Map();
  let current = first;

  try {
    for (;;) {
      // The first frame has no previous sample, so its CPU reads as unknown rather than zero.
      yield frame(current, previous);
      previous = current;
      await delay(INTERVAL, undefined, { signal });
      current = await docker.sampleStats();
    }
  } catch {
    // The client went away, or the daemon did after a good first frame. Ending the stream is all
    // that is left: the status line is long gone, so the browser reconnects and gets the 503 then.
  }
}

/**
 * Live resource usage for every running Compose container, as Server-Sent Events. The payload is
 * keyed by full container id, so the same stream serves one app's container table and the
 * whole-inventory totals — a caller reads the ids it happens to be showing.
 */
export const GET = apiRoute(
  { log: "Failed to stream Docker container statistics", unavailable: "Les statistiques Docker sont indisponibles." },
  async request => {
    // Sampled before the response so an unreachable daemon surfaces as a 503 with a message,
    // rather than as a 200 that streams nothing and has the browser reconnect forever.
    const first = await docker.sampleStats();

    return sseStream(frames(first, request.signal));
  },
);
