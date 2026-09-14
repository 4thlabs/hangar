import "server-only";

import { PassThrough, type Readable } from "node:stream";
import type { CommandRunner } from "#libs/hangar";
import { COMPOSE_PROJECT_LABEL, DockerNotFoundError, inspectComposeContainers, isComposeOneoff } from "./projects.ts";

const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;

/**
 * Opens a following log stream for one container, after verifying it belongs to `project`
 * (so a caller can't read logs from a container outside the project they're authorized for).
 * `docker logs` demultiplexes stdout/stderr itself, and the runtime merges the two pipes back
 * into the single interleaved stream the log view expects.
 * @param runner Runs the `docker` commands
 * @param project The Compose project the container is expected to belong to
 * @param containerId The container id; must match {@link CONTAINER_ID} or it's treated as not found
 * @param signal Aborted when the client disconnects; kills the `docker logs -f` child
 * @throws {DockerNotFoundError} if the id is malformed, missing, or belongs to another project
 */
export async function openDockerLogs(
  runner: CommandRunner,
  project: string,
  containerId: string,
  signal: AbortSignal,
): Promise<Readable> {
  if (!CONTAINER_ID.test(containerId)) throw new DockerNotFoundError(`container ${containerId}`);

  // Listing by project label, rather than inspecting the id directly, means an id from another
  // project is indistinguishable from one that doesn't exist: no cross-project probing.
  const containers = await inspectComposeContainers(runner, project);
  const container = containers.find(candidate => candidate.Id.startsWith(containerId));
  const labels = container?.Config.Labels;

  if (!labels || labels[COMPOSE_PROJECT_LABEL] !== project || isComposeOneoff(labels)) {
    throw new DockerNotFoundError(`container ${containerId}`);
  }

  const output = new PassThrough();

  void runner
    .run("docker", ["logs", "-f", "--tail", "200", "--timestamps", container.Id], { pipe: output, signal })
    // An aborted stream rejects by design, and the client that would read the error is gone.
    .catch(() => {})
    .finally(() => output.end());

  return output;
}
