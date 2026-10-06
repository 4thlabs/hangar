import { setTimeout as delay } from "node:timers/promises";
import { apiRoute, sseEvent, sseStream } from "#app/api/api-route.ts";
import type { Samples } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { ContainerStats } from "#libs/docker";
import { logger } from "#libs/logs";

/** How often a frame goes out. Also the window the CPU percentage is measured over. */
const INTERVAL = 1_000;

/** One event, carrying every container's metrics; CPU is the delta from `previous`. */
function frame(current: Samples, previous: Samples) {
  const metrics = [...current].map(([id, raw]) => [id, new ContainerStats(raw, previous.get(id)).metrics()]);

  return sseEvent(Object.fromEntries(metrics));
}

/** Each connection keeps its own previous sample: a CPU percentage is a delta, and a sample costs only ~2 ms. */
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
  } catch (error) {
    // Client gone (normal, not logged) or daemon failed; the browser reconnects and gets the 503.
    if (!signal.aborted) {
      logger.warn("Docker statistics stream failed", { error });
    }
  }
}

/** Live resource usage of every running Compose container over SSE, keyed by full container id. */
export const GET = apiRoute(
  { log: "Failed to stream Docker container statistics", unavailable: "Les statistiques Docker sont indisponibles." },
  async request => {
    // Sampled first so a dead daemon is a 503, not an empty 200.
    const first = await docker.sampleStats();

    return sseStream(frames(first, request.signal));
  },
);
