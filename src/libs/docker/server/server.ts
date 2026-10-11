import "server-only";
import Dockerode from "dockerode";
import { cache } from "#libs/cache/server";
import { hangar } from "#libs/hangar/server";
import { Docker } from "../docker.ts";
import { DockerSwarm } from "../swarm.ts";

// Reused across HMR reloads, otherwise dev stacks a second instance following the daemon
const globalForDocker = globalThis as unknown as { docker?: Docker; swarm?: DockerSwarm };

/** One connection to the daemon, shared by both layers. */
const client = new Dockerode();

/**
 * The Docker layer for the web server, scoped to the apps this Hangar installed. Its client takes no
 * options, so it honours `DOCKER_HOST`.
 *
 * Not following the daemon's events yet: module scope in the RSC graph is evaluated by `waku build`,
 * where there is no daemon to follow. `src/app/middleware/cache-warm.ts` calls `follow` with the server.
 */
export const docker = globalForDocker.docker ?? new Docker(client, hangar.store, cache);

globalForDocker.docker = docker;

/**
 * The swarm this host belongs to, read-only. Kept current by the events `docker` follows: they
 * refresh everything under `docker:swarm`.
 */
export const swarm = globalForDocker.swarm ?? new DockerSwarm(client, cache);

globalForDocker.swarm = swarm;
