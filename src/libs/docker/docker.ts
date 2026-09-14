import "server-only";

import { PassThrough, type Readable } from "node:stream";
import type Dockerode from "dockerode";
import {
  ComposeProjects,
  DockerNotFoundError,
  type ComposeContainerSource,
  type ComposeProjectDetail,
  type ComposeProjectsSnapshot,
} from "./compose.ts";
import type { ContainerStatsSample } from "./stats.ts";

/** Raw stats samples keyed by full container id. */
export type Samples = Map<string, ContainerStatsSample>;

/**
 * The slice of `HangarStore` this layer needs: which apps Hangar installed, and so which
 * Compose projects a caller may see. An interface rather than the class so a test can pass a
 * literal, the way `HangarStore` takes a `CommandRunner`.
 */
export interface InstalledApps {
  installedProjectIds(): Set<string>;
}

/**
 * The Docker Engine API, scoped to the apps Hangar installed. Talks to the socket directly
 * rather than shelling out: an inspect costs ~5ms instead of a process spawn, and a stats sample
 * comes back as numbers instead of strings like `"2.87GiB"` that would have to be parsed back.
 *
 * Compose operations are not part of this API and still go through the CLI; see `hangar.store`.
 */
export class Docker {
  /** A full or short container id, as the Engine API spells them. */
  private static readonly CONTAINER_ID = /^[a-f0-9]{12,64}$/i;

  /** The Engine API client. */
  private readonly docker: Dockerode;

  /** What Hangar installed; read per call, so a freshly installed app shows up without a restart. */
  private readonly apps: InstalledApps;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param apps The installed-app lookup, satisfied by `hangar.store`
   */
  constructor(docker: Dockerode, apps: InstalledApps) {
    this.docker = docker;
    this.apps = apps;
  }

  /**
   * Lists every Compose-labeled container, or just one project's, in both API views. The daemon
   * applies the label filter itself, and an inspect costs a few milliseconds over the socket, so
   * they all go out at once.
   * @param project When set, only that Compose project's containers
   */
  private async inspectContainers(project?: string): Promise<ComposeContainerSource[]> {
    const label = project ? `${ComposeProjects.LABEL.project}=${project}` : ComposeProjects.LABEL.project;
    const listed = await this.docker.listContainers({ all: true, filters: { label: [label] } });

    return Promise.all(listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })));
  }

  /** Lists every app Hangar installed, as lightweight summaries of their Docker state. */
  async listProjects(): Promise<ComposeProjectsSnapshot> {
    const compose = new ComposeProjects(await this.inspectContainers());

    return { projects: compose.summaries(this.apps.installedProjectIds()) };
  }

  /**
   * Fetches the topology (services, containers, ports) of one installed app. No resource usage:
   * that is sampled separately and arrives over the stats stream.
   * An installed app with no container yet resolves to a stopped project with no service.
   * @param project The Compose project name
   * @throws {DockerNotFoundError} if the project is not an installed app
   */
  async projectDetail(project: string): Promise<ComposeProjectDetail> {
    const compose = new ComposeProjects(await this.inspectContainers(project), project);

    return compose.detail(project, this.apps.installedProjectIds());
  }

  /**
   * Opens a following log stream for one container, after verifying it belongs to `project`
   * (so a caller can't read logs from a container outside the project they're authorized for).
   * @param project The Compose project the container is expected to belong to
   * @param containerId The container id; must match {@link Docker.CONTAINER_ID} or it's treated as not found
   * @param signal Aborted when the client disconnects; tears the log stream down
   * @throws {DockerNotFoundError} if the id is malformed, missing, or belongs to another project
   */
  async openLogs(project: string, containerId: string, signal: AbortSignal): Promise<Readable> {
    if (!Docker.CONTAINER_ID.test(containerId)) throw new DockerNotFoundError(`container ${containerId}`);

    // Listing by project label, rather than inspecting the id directly, means an id from another
    // project is indistinguishable from one that doesn't exist: no cross-project probing.
    const compose = new ComposeProjects(await this.inspectContainers(project), project);
    const container = compose.find(containerId);

    if (!container) throw new DockerNotFoundError(`container ${containerId}`);

    // Typed as a bare readable because `follow` is only known to produce a stream at runtime.
    const logs = (await this.docker.getContainer(container.info.Id).logs({
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
    else this.docker.modem.demuxStream(logs, output, output);

    logs.on("end", () => output.end());
    logs.on("error", () => output.end());
    signal.addEventListener("abort", () => logs.destroy());

    return output;
  }

  /**
   * Takes one sample of every running Compose container, in parallel. Covers the whole host
   * rather than one app: the caller reads whichever ids it happens to be showing.
   */
  async sampleStats(): Promise<Samples> {
    const running = await this.docker.listContainers({ filters: { label: [ComposeProjects.LABEL.project] } });
    const samples = await Promise.all(
      running.map(
        async entry =>
          [
            entry.Id,
            (await this.docker.getContainer(entry.Id).stats({ stream: false, "one-shot": true })) as unknown,
          ] as const,
      ),
    );

    return new Map(samples.map(([id, raw]) => [id, raw as ContainerStatsSample]));
  }
}
