import type { MiddlewareHandler } from "hono/types";
import { appsSnapshot } from "#app/snapshots.ts";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { resolveWidgets } from "#libs/widgets";
import { widgetHost } from "#libs/widgets/server";

/** How often the snapshots are topped up. Comfortably inside every TTL + grace window they feed. */
const INTERVAL = 30_000;

/** Reused across HMR reloads, otherwise dev stacks a second loop on every edit. */
const globalForWarm = globalThis as unknown as { warmTimer?: NodeJS.Timeout };

/**
 * Fills every cache the first page render reads from, so it reads from memory instead of waiting.
 *
 * A widget and the apps page both suspend while their data loads, which is a skeleton or a spinner
 * on screen. The caches underneath answer instantly once they hold something — but they are filled
 * on read, so without this the very first visitor is the one who fills them, and pays for it.
 *
 * Each read here goes through its own cache, so a value still fresh costs a map lookup and the TTL,
 * not this interval, is what decides how often a service is really asked.
 */
function tick() {
  const widgets = resolveWidgets(hangar.store.config.widgets(), widgetHost);

  // Failures are the render's to report, not the loop's: a service that is down leaves nothing
  // cached and the widget falls back to its error card, exactly as it would without warming.
  // Each page contributes one snapshot, so this list cannot fall behind what a page actually
  // reads the way a hand-written list of ingredients did.
  void Promise.all([appsSnapshot.warm(), ...widgets.map(placement => placement.widget.warm())]);
}

/**
 * Starts the warm loop, once per process.
 *
 * Waku awaits every middleware factory before it runs the chain, so this must not await: the first
 * tick goes out behind the response rather than in front of it. It is also the earliest safe place
 * to start — module scope in the RSC graph is evaluated by `waku build`, where there is no daemon
 * and no service to reach, while middleware modules are only bundled, never run.
 *
 * In production the first request is the container healthcheck hitting `/login` about ten seconds
 * in, so the caches are warm long before anyone navigates. In dev the first request is usually the
 * page being loaded, so a skeleton shows once per dev server start.
 */
export default (): MiddlewareHandler => {
  clearInterval(globalForWarm.warmTimer);

  const timer = setInterval(tick, INTERVAL);

  // Never a reason to hold the process open: everything in here is a cache, not work owed to anyone.
  timer.unref();
  globalForWarm.warmTimer = timer;

  logger.info(`Warming the dashboard caches every ${INTERVAL / 1_000}s`);

  let first = true;

  // Waku skips the rest of the chain on a falsy handler, so this passes through rather than
  // returning nothing. The first tick waits for one request to finish because `jobs-runner` only
  // configures Sidequest after its own `next()`, and a widget reading the last image check before
  // that logs an error and renders without its update badges.
  return async (_c, next) => {
    await next();

    if (!first) return;
    first = false;
    tick();
  };
};
