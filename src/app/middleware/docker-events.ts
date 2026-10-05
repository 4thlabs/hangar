import type { MiddlewareHandler } from "hono/types";
import { dockerEvents } from "#libs/docker/server";
import type { DockerEvents } from "#libs/docker";

/** The stream followed so far, stopped across HMR reloads; otherwise dev stacks one per edit. */
const globalForEvents = globalThis as unknown as { dockerEvents?: DockerEvents };

/**
 * Follows the daemon's events, once per process, so the Docker snapshots move when the daemon
 * does — whoever changed it, from wherever.
 *
 * Started from the middleware factory for the reasons `cache-warm.ts` gives: it is the earliest
 * place that runs with the server and never at build time. `start` returns at once, so the factory
 * Waku awaits is not held up by the daemon.
 */
export default (): MiddlewareHandler => {
  globalForEvents.dockerEvents?.stop();
  dockerEvents.start();
  globalForEvents.dockerEvents = dockerEvents;

  // Waku skips the rest of the chain on a falsy handler, so this passes through rather than
  // returning nothing.
  return (_c, next) => next();
};
