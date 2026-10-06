import type { MiddlewareHandler } from "hono/types";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { appsSnapshot } from "#modules/apps/snapshots.ts";
import { widgetRegistry } from "#modules/widgets/server/server.ts";

/** How often the snapshots are topped up. Comfortably inside every TTL + grace window they feed. */
const INTERVAL = 30_000;

/** Reused across HMR reloads, otherwise dev stacks a second loop on every edit. */
const globalForWarm = globalThis as unknown as { warmTimer?: NodeJS.Timeout };

/** Fills the caches the first render reads. Each cache's TTL, not INTERVAL, decides how often services are asked. */
function tick() {
  const widgets = widgetRegistry.resolve(hangar.store.config.widgets());

  // Failures are the render's to report: a service that is down leaves nothing cached and the widget shows its
  // error card. One snapshot per page, so this list cannot fall behind what a page reads.
  void Promise.all([appsSnapshot.warm(), ...widgets.map(placement => placement.widget.warm())]);
}

/**
 * Starts the warm loop and Docker events once per process. Must not await: Waku awaits middleware factories,
 * and `waku build` evaluates module scope with no daemon.
 */
export default (): MiddlewareHandler => {
  clearInterval(globalForWarm.warmTimer);

  const timer = setInterval(tick, INTERVAL);

  // Never a reason to hold the process open: everything in here is a cache, not work owed to anyone.
  timer.unref();
  globalForWarm.warmTimer = timer;

  logger.info(`Warming the dashboard caches every ${INTERVAL / 1_000}s`);

  docker.follow();

  let first = true;

  // Waku skips the rest of the chain on a falsy handler, so this passes through. The first tick waits for one
  // request: `jobs-runner` configures Sidequest only after its own `next()`, and the image check needs it.
  return async (_c, next) => {
    await next();

    if (!first) {
      return;
    }

    first = false;
    tick();
  };
};
