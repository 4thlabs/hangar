import "server-only";
import Dockerode from "dockerode";
import { hangar } from "#libs/hangar/server";
import { Docker } from "../docker.ts";

/** Reused across HMR reloads: a re-evaluated module must not leave the previous instance following the daemon. */
const globalForDocker = globalThis as unknown as { docker?: Docker };

/** The web server's Engine API client; no options, so it honours `DOCKER_HOST`. */
const client = new Dockerode();

globalForDocker.docker?.unfollow();

/**
 * The Docker layer for the web server, scoped to the apps this Hangar installed.
 *
 * Not following the daemon's events yet: module scope in the RSC graph is evaluated by `waku build`,
 * where there is no daemon to follow. `src/app/middleware/cache-warm.ts` calls `follow` with the server.
 */
export const docker = new Docker(client, hangar.store);

globalForDocker.docker = docker;
