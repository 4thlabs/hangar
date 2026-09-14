import "server-only";

import { PassThrough, type Readable } from "node:stream";
import { docker } from "./client.ts";
import { composeManaged, DockerNotFoundError, inspectComposeContainers } from "./projects.ts";

const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;

/**
 * Opens a following log stream for one container, after verifying it belongs to `project`
 * (so a caller can't read logs from a container outside the project they're authorized for).
 * @param project The Compose project the container is expected to belong to
 * @param containerId The container id; must match {@link CONTAINER_ID} or it's treated as not found
 * @param signal Aborted when the client disconnects; tears the log stream down
 * @throws {DockerNotFoundError} if the id is malformed, missing, or belongs to another project
 */
export async function openDockerLogs(project: string, containerId: string, signal: AbortSignal): Promise<Readable> {
  if (!CONTAINER_ID.test(containerId)) throw new DockerNotFoundError(`container ${containerId}`);

  // Listing by project label, rather than inspecting the id directly, means an id from another
  // project is indistinguishable from one that doesn't exist: no cross-project probing.
  const containers = composeManaged(await inspectComposeContainers(project), project);
  const container = containers.find(candidate => candidate.info.Id.startsWith(containerId));

  if (!container) throw new DockerNotFoundError(`container ${containerId}`);

  // Typed as a bare readable because `follow` is only known to produce a stream at runtime.
  const logs = (await docker.getContainer(container.info.Id).logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 200,
    timestamps: true,
  })) as unknown as Readable;

  const output = new PassThrough();

  // Without a TTY the daemon multiplexes stdout and stderr into one framed stream; demuxing
  // both back into the same sink is what gives the log view its interleaved output.
  if (container.detail.Config.Tty) logs.pipe(output);
  else docker.modem.demuxStream(logs, output, output);

  logs.on("end", () => output.end());
  logs.on("error", () => output.end());
  signal.addEventListener("abort", () => logs.destroy());

  return output;
}
