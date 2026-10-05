import "server-only";

import Dockerode from "dockerode";
import { hangar } from "#libs/hangar/server";
import { Docker } from "../docker.ts";
import { DockerEvents } from "../events.ts";

/**
 * The one Engine API client the web server talks through.
 *
 * Constructed with no options so it applies its own defaults, `DOCKER_HOST` included. This is the
 * only place the package is imported as a value: everywhere else takes the client by injection,
 * which keeps the rest of the lib out of the browser bundle.
 */
const client = new Dockerode();

/**
 * The Docker layer for the web server, scoped to the apps this Hangar installed.
 */
export const docker = new Docker(client, hangar.store);

/**
 * The daemon's events, refreshing {@link docker}'s snapshots as they come.
 *
 * Not started here: module scope in the RSC graph is evaluated by `waku build`, where there is no
 * daemon to follow. `src/app/middleware/docker-events.ts` starts it with the server.
 */
export const dockerEvents = new DockerEvents(client, change => void docker.refresh([change]));
