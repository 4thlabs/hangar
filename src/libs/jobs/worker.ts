import Dockerode from "dockerode";
import { Cache } from "#libs/cache";
import { db } from "#libs/db";
import { Docker } from "#libs/docker";
import { Notifications } from "#libs/notifications";
import type { JobServices } from "./services.ts";

/**
 * The Sidequest worker's composition root. Built per run, so a run never reads a cache left warm by
 * the previous one. No `server-only` guard: see AGENTS.md § server-only.
 */
export async function createWorkerServices(): Promise<JobServices> {
  // Imported on call rather than at load: the web server and the tests load every job module,
  // and loading this one opens the store.
  const { hangar } = await import("#libs/hangar/server");

  return {
    hangar,
    // Same arguments the web server passes in `#libs/docker/server`, with a cache of the run's own.
    docker: new Docker(new Dockerode(), hangar.store, new Cache()),
    notifications: new Notifications(db),
  };
}
