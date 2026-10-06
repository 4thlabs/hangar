import type { MiddlewareHandler } from "hono/types";
import { cache } from "#libs/cache/server";
import { docker } from "#libs/docker/server";
import { logger } from "#libs/logs";

/** How often the cache reloads what would go stale before the next tick. Shorter than every TTL it serves. */
const INTERVAL = 30_000;

/** Reused across HMR reloads, otherwise dev stacks a second loop on every edit. */
const globalForWarm = globalThis as unknown as { stopKeepingWarm?: () => void };

/**
 * Keeps the cache warm and follows the Docker events, once per process. Here rather than at module scope:
 * Waku awaits middleware factories, and `waku build` evaluates module scope with no daemon.
 */
export default (): MiddlewareHandler => {
  globalForWarm.stopKeepingWarm?.();
  globalForWarm.stopKeepingWarm = cache.keepWarm(INTERVAL);

  logger.info(`Keeping the cache warm every ${INTERVAL / 1_000}s`);

  docker.follow();

  // Waku skips the rest of the chain on a falsy handler, so this passes through.
  return async (_c, next) => {
    await next();
  };
};
