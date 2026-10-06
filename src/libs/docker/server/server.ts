import "server-only";
import Dockerode from "dockerode";
import { cache } from "#libs/cache/server";
import { hangar } from "#libs/hangar/server";
import { Docker } from "../docker.ts";

// Reused across HMR reloads, otherwise dev stacks a second instance following the daemon
const globalForDocker = globalThis as unknown as { docker?: Docker };

/**
 * The Docker layer for the web server, scoped to the apps this Hangar installed. Its client takes no
 * options, so it honours `DOCKER_HOST`.
 *
 * Not following the daemon's events yet: module scope in the RSC graph is evaluated by `waku build`,
 * where there is no daemon to follow. `src/app/middleware/cache-warm.ts` calls `follow` with the server.
 */
export const docker = globalForDocker.docker ?? new Docker(new Dockerode(), hangar.store, cache);

globalForDocker.docker = docker;
