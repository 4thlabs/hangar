import "server-only";

import Docker from "dockerode";

/**
 * The Docker Engine API client. Talks to the socket directly rather than shelling out: an
 * inspect costs ~5ms instead of a process spawn, and a stats sample comes back as numbers
 * instead of strings like `"2.87GiB"` that would have to be parsed back.
 *
 * Constructed with no options so dockerode applies its own defaults, `DOCKER_HOST` included.
 * Compose operations are not part of this API and still go through the CLI; see `hangar.store`.
 */
export const docker = new Docker();
