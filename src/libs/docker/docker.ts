import { PassThrough, type Readable } from "node:stream";
import type Dockerode from "dockerode";
import {
  ComposeProjects,
  DockerNotFoundError,
  type ComposeContainerSource,
  type ComposeProjectDetail,
  type ComposeProjectsSnapshot,
  type ImageUpdate,
  type ImageUpdateStatus,
} from "./compose.ts";
import { logger } from "#libs/logs";
import type { ContainerStatsSample } from "./stats.ts";

/** Raw stats samples keyed by full container id. */
export type Samples = Map<string, ContainerStatsSample>;

/** Host-wide usage of the local Docker daemon, in the shape the dashboard widget renders. */
export type DockerOverview = {
  version: string;
  containers: { total: number; running: number; stopped: number };
  images: { total: number; unused: number; size: number };
  volumes: { total: number; inUse: number; unused: number };
};

/** The `info` fields {@link Docker.overview} reads; the client hands them back untyped. */
type SystemInfo = {
  ServerVersion: string;
  Containers: number;
  ContainersRunning: number;
  ContainersStopped: number;
};

/** The `df` fields {@link Docker.overview} reads; the client hands them back untyped. */
type SystemDiskUsage = {
  LayersSize: number;
  Images: Dockerode.ImageInfo[] | null;
  Volumes: Dockerode.VolumeInspectInfo[] | null;
};

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
 *
 * No `server-only` guard here on purpose: Sidequest runs a job by `import()`ing its module in a
 * plain Node process, where that marker throws. `dockerode` is only ever a type in this file, so
 * the guard lives at the composition root that constructs it — see `./server/server.ts`.
 */
export class Docker {
  /** A full or short container id, as the Engine API spells them. */
  private static readonly CONTAINER_ID = /^[a-f0-9]{12,64}$/i;

  /** The Engine API client. */
  private readonly docker: Dockerode;

  /** What Hangar installed; read per call, so a freshly installed app shows up without a restart. */
  private readonly apps: InstalledApps;

  /** Default {@link ttl}: long enough to cover one page's renders, short enough to feel live. */
  private static readonly TTL = 5_000;

  /** How long a settled sweep is served again, in milliseconds. */
  private readonly ttl: number;

  /** One entry per label filter. See {@link inspectContainers}. */
  private readonly sweeps = new Map<string, { containers: Promise<ComposeContainerSource[]>; until: number }>();

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param apps The installed-app lookup, satisfied by `hangar.store`
   * @param ttl How long a container sweep is reused; injected so a test can drive it
   */
  constructor(docker: Dockerode, apps: InstalledApps, ttl = Docker.TTL) {
    this.docker = docker;
    this.apps = apps;
    this.ttl = ttl;
  }

  /**
   * Lists every Compose-labeled container, or just one project's, in both API views. The daemon
   * applies the label filter itself, and an inspect costs a few milliseconds over the socket, so
   * they all go out at once.
   *
   * Cached per label filter, because this is `1 + N` round trips and nothing above it is cheap
   * about asking: the apps page re-renders itself every 30 seconds, per open tab. A sweep still
   * in flight never expires, so concurrent callers share one — that part is free, staleness only
   * begins once it has settled. A failed sweep is dropped rather than cached.
   *
   * @param project When set, only that Compose project's containers
   */
  private async inspectContainers(project?: string): Promise<ComposeContainerSource[]> {
    const label = project ? `${ComposeProjects.LABEL.project}=${project}` : ComposeProjects.LABEL.project;
    const cached = this.sweeps.get(label);

    if (cached && Date.now() < cached.until) return cached.containers;

    const containers = (async () => {
      const listed = await this.docker.listContainers({ all: true, filters: { label: [label] } });

      return Promise.all(
        listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })),
      );
    })();

    const sweep = { containers, until: Number.POSITIVE_INFINITY };
    this.sweeps.set(label, sweep);

    containers.then(
      () => (sweep.until = Date.now() + this.ttl),
      () => this.sweeps.delete(label),
    );

    return containers;
  }

  /**
   * Drops every cached container sweep. Called after a Compose command, which is the one moment
   * the page behind it is guaranteed to ask again and must not be told what was true before.
   */
  invalidate() {
    this.sweeps.clear();
  }

  /**
   * Asks the registry, for every image the installed apps run, whether it still serves what is
   * running here. The daemon does the talking (`/distribution/{name}/json`), so its own registry
   * credentials apply and nothing here handles auth.
   *
   * One entry per project and image reference, but one registry call per *reference*: replicas of
   * a service share an image, and two apps may share one too. Anything the daemon cannot answer
   * reads as `unknown` rather than throwing, so one unreachable registry does not cost the report
   * — and, more importantly, never renders as a false "update available".
   */
  async imageUpdates(): Promise<ImageUpdate[]> {
    const installed = this.apps.installedProjectIds();
    const pairs = new Map<string, { project: string; image: string }>();

    for (const { info } of await this.inspectContainers()) {
      const project = info.Labels[ComposeProjects.LABEL.project] ?? "";

      if (installed.has(project)) pairs.set(`${project}\u0000${info.Image}`, { project, image: info.Image });
    }

    const references = [...new Set([...pairs.values()].map(pair => pair.image))];
    const statuses = new Map(
      await Promise.all(references.map(async image => [image, await this.imageStatus(image)] as const)),
    );

    return [...pairs.values()].map(pair => ({ ...pair, status: statuses.get(pair.image) ?? "unknown" }));
  }

  /**
   * One reference's verdict against its registry.
   * @param image The reference as Compose runs it, e.g. `nginx:alpine`
   */
  private async imageStatus(image: string): Promise<ImageUpdateStatus> {
    // Pinned to a digest, or named by id: the reference already denotes one exact image.
    if (image.includes("@sha256:") || image.startsWith("sha256:")) return "current";

    try {
      const local = await this.docker.getImage(image).inspect();

      // An image built here was never pulled, so it carries no registry digest to compare against.
      if (!local.RepoDigests?.length) return "unknown";

      const remote = await this.docker.getImage(image).distribution({ abortSignal: AbortSignal.timeout(10_000) });

      return local.RepoDigests.some(digest => digest.endsWith(`@${remote.Descriptor.digest}`)) ? "current" : "outdated";
    } catch (error) {
      // Unreachable registry, rate limit, private image with no credentials: all say "don't know".
      logger.warn("Could not check an image for updates", { error, image });

      return "unknown";
    }
  }

  /**
   * Host-wide counts for the local daemon: the whole engine, not just the apps Hangar installed,
   * so the dashboard reports the local environment the way Arcane reports a remote one.
   *
   * Two endpoints because neither answers alone: `info` carries the container tallies and the
   * daemon version, `df` the disk usage (which images nothing runs, which volumes nothing mounts).
   */
  async overview(): Promise<DockerOverview> {
    const [info, usage] = (await Promise.all([this.docker.info(), this.docker.df()])) as [SystemInfo, SystemDiskUsage];
    const images = usage.Images ?? [];
    const volumes = usage.Volumes ?? [];
    const inUse = volumes.filter(volume => (volume.UsageData?.RefCount ?? 0) > 0).length;

    return {
      version: info.ServerVersion,
      containers: { total: info.Containers, running: info.ContainersRunning, stopped: info.ContainersStopped },
      // `LayersSize` rather than the sum of the images: layers shared between images are on disk once.
      images: {
        total: images.length,
        unused: images.filter(image => image.Containers === 0).length,
        size: usage.LayersSize,
      },
      volumes: { total: volumes.length, inUse, unused: volumes.length - inUse },
    };
  }

  /**
   * Lists every app Hangar installed, as lightweight summaries of their Docker state.
   * ponytail: the sweep is unfiltered, so it inspects every Compose container on the host and
   * throws away the ones Hangar did not install. Filter the daemon-side label query by
   * `installedProjectIds()` if N ever hurts more than the cache absorbs.
   */
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
