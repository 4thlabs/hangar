import Dockerode from "dockerode";
import { db } from "#libs/db";
import { Docker } from "#libs/docker";
import { Notifications } from "#libs/notifications";
import type { JobServices } from "./services.ts";

/**
 * The composition root of the Sidequest worker: the one place a job's services are bound, as each
 * library's `server.ts` is for the web server. No `server-only` guard: the worker is a plain Node
 * process, where that marker throws.
 *
 * Built per run rather than once per process, so a run never reads a cache left warm by the
 * previous one hours earlier.
 */
export async function createWorkerServices(): Promise<JobServices> {
  // Imported on call rather than at load: the web server and the tests load every job module,
  // and loading this one opens the store.
  const { hangar } = await import("#libs/hangar/server");

  return {
    hangar,
    // Same two arguments the web server passes in `#libs/docker/server`.
    docker: new Docker(new Dockerode(), hangar.store),
    notifications: new Notifications(db),
  };
}
