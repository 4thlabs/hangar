import "server-only";
import Dockerode from "dockerode";
import { hangar } from "#libs/hangar/server";
import { Docker } from "../docker.ts";
import { DockerEvents } from "../events.ts";

/** The web server's Engine API client; no options, so it honours `DOCKER_HOST`. */
const client = new Dockerode();

/** The Docker layer for the web server, scoped to the apps this Hangar installed. */
export const docker = new Docker(client, hangar.store);

/**
 * The daemon's events, refreshing {@link docker}'s snapshots as they come.
 *
 * Not started here: module scope in the RSC graph is evaluated by `waku build`, where there is no
 * daemon to follow. `src/app/middleware/cache-warm.ts` starts it with the server.
 */
export const dockerEvents = new DockerEvents(client, change => void docker.refresh([change]));
