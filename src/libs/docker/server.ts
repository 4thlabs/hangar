import "server-only";

import Dockerode from "dockerode";
import { hangar } from "#libs/hangar/server";
import { Docker } from "./docker.ts";

/**
 * The Docker layer for the web server, scoped to the apps this Hangar installed.
 *
 * `Dockerode` is constructed with no options so it applies its own defaults, `DOCKER_HOST`
 * included. This is the only place the package is imported as a value: everywhere else takes
 * the client by injection, which keeps the rest of the lib out of the browser bundle.
 */
export const docker = new Docker(new Dockerode(), hangar.store);
