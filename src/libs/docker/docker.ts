import { PassThrough, type Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import type Dockerode from "dockerode";
import {
  ComposeProjects,
  DockerNotFoundError,
  type ComposeContainerSource,
  type ComposeProjectDetail,
  type ComposeProjectsSnapshot,
  type RemoteDigests,
  type RunningImage,
  type UpdateCheck,
} from "./compose.ts";
import { logger } from "#libs/logs";
import { Cache, type Snapshot } from "#libs/cache";
import type { ContainerStatsSample } from "./stats.ts";

/** What the daemon answers for a container that went away between a list and a call on it. */
const NOT_FOUND = 404;

/**
 * The values of the calls that succeeded. Failures are dropped so one container cannot sink the
 * whole read; all but the expected 404 race are logged.
 * @param operation What was being done, for the log line
 */
function fulfilledValues<T>(results: PromiseSettledResult<T>[], operation: string): T[] {
  for (const result of results) {
    const isExpectedRace =
      result.status === "rejected" && (result.reason as { statusCode?: number }).statusCode === NOT_FOUND;

    if (result.status === "rejected" && !isExpectedRace) {
      logger.warn(`Could not ${operation}`, { error: result.reason });
    }
  }

  return results.filter(result => result.status === "fulfilled").map(result => result.value);
}

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
 * What a daemon event can make stale: the Compose containers, the local image list, or the
 * host-wide overview. See {@link Docker.refresh} and `DockerEvents`.
 */
export type DockerChange = "containers" | "images" | "overview";

/** Every {@link DockerChange}, for a caller that cannot tell which one happened. */
export const DockerChanges: readonly DockerChange[] = ["containers", "images", "overview"];

/** The slice of `HangarStore` this layer needs: which Compose projects a caller may see. */
export interface InstalledApps {
  installedProjectIds(): Set<string>;
}

/**
 * The Docker Engine API over the socket, scoped to the apps Hangar installed: an inspect costs
 * ~5 ms instead of a process spawn. Compose commands go through the CLI (`hangar.store`).
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class Docker {
  /** A full or short container id, as the Engine API spells them. */
  private static readonly ContainerId = /^[a-f0-9]{12,64}$/i;

  /**
   * Pause between two registry calls: Docker Hub and ghcr.io both rate-limit a burst from one IP.
   * ponytail: one gap shared by every registry; split it if a mixed host makes the check slow.
   */
  private static readonly RegistryGapMs = 100;

  /** What {@link Docker.remoteDigest} returns once the registry says "too many requests". */
  private static readonly RateLimited = Symbol("rate-limited");

  private readonly docker: Dockerode;

  /** Read per call, so a freshly installed app shows up without a restart. */
  private readonly apps: InstalledApps;

  /**
   * Default {@link ttl}. `DockerEvents` keeps the containers live; this is only the net for a
   * change the event stream missed.
   */
  private static readonly Ttl = 60_000;

  /** How long past its TTL a snapshot is still served while it reloads; longer than a warm-loop tick. */
  private static readonly Grace = 120_000;

  /** Same net as {@link Ttl}, looser: `df` is the daemon's slowest call and only the dashboard reads it. */
  private static readonly OverviewTtl = 300_000;

  /** Nothing here changes fast enough to be worth blocking a paint. */
  private static readonly OverviewGrace = 3_600_000;

  private readonly cache = new Cache();

  /** Every Compose-labeled container on the host; every other read narrows it in memory. */
  private readonly containers: Snapshot<ComposeContainerSource[]>;

  /** The registry digests of every local image, by image id; see {@link listImages}. */
  private readonly images: Snapshot<Map<string, string[]>>;

  /**
   * Every installed app, as summaries of its Docker state: `read()` to wait, `peek()` not to.
   * ponytail: every Compose container is inspected, then filtered; Docker ANDs repeated `label`
   * filters, so the only daemon-side narrowing is one list per project, which is worse.
   */
  readonly projects: Snapshot<ComposeProjectsSnapshot>;

  /**
   * Every container of an installed app, with the registry digests of the image it runs. Joined on
   * the same containers as {@link projects}, so the update badge moves with them.
   */
  readonly runningImages: Snapshot<RunningImage[]>;

  /** Host-wide counts for the whole engine, not just the installed apps, as Arcane reports a remote one. */
  readonly overview: Snapshot<DockerOverview>;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param apps The installed-app lookup, satisfied by `hangar.store`
   * @param ttl How long the loaded containers and images are reused; injected so a test can drive it
   */
  constructor(docker: Dockerode, apps: InstalledApps, ttl = Docker.Ttl) {
    this.docker = docker;
    this.apps = apps;
    this.containers = this.cache.define("containers", ttl, Docker.Grace, this.loadContainers);
    this.projects = Cache.join(this.containers, sources => ({
      projects: new ComposeProjects(sources).summaries(this.apps.installedProjectIds()),
    }));

    this.images = this.cache.define("images", ttl, Docker.Grace, this.listImages);

    this.runningImages = Cache.join(this.containers, this.images, (sources, digests) => {
      const installed = this.apps.installedProjectIds();

      // By the image id the container runs, never by its reference: `compose pull` moves the tag
      // and leaves the containers on the image they were created with, so resolving the tag would
      // call an app current while it still runs the old one.
      return sources
        .map(({ info }) => ({
          project: info.Labels[ComposeProjects.Label.project] ?? "",
          image: info.Image,
          digests: digests.get(info.ImageID) ?? [],
        }))
        .filter(running => installed.has(running.project));
    });

    this.overview = this.cache.define("overview", Docker.OverviewTtl, Docker.OverviewGrace, this.loadOverview);
  }

  /**
   * The registry digests of every local image, by image id. Never rejects: the digests only feed
   * the update badge, which must never fail the Apps page.
   */
  private readonly listImages = async (): Promise<Map<string, string[]>> => {
    try {
      return new Map((await this.docker.listImages()).map(image => [image.Id, image.RepoDigests ?? []]));
    } catch (error) {
      logger.warn("Could not list the local images", { error });

      return new Map();
    }
  };

  /**
   * The load behind {@link containers}: one list, then every inspect at once. A container that exits
   * in between answers 404, common right after a `compose down`, so it must not fail the load.
   */
  private readonly loadContainers = async (): Promise<ComposeContainerSource[]> => {
    const listed = await this.docker.listContainers({
      all: true,
      filters: { label: [ComposeProjects.Label.project] },
    });
    const inspected = await Promise.allSettled(
      listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })),
    );

    return fulfilledValues(inspected, "inspect a container");
  };

  /**
   * Reloads what a change made stale; readers keep the current snapshot meanwhile. Called by
   * `DockerEvents`, and awaited by a caller about to read the new state.
   * @param changes What went stale; everything when the caller cannot tell
   * @returns Settles once each reload has, and never rejects
   */
  refresh(changes: Iterable<DockerChange> = DockerChanges): Promise<void> {
    const snapshots = { containers: this.containers, images: this.images, overview: this.overview };

    return Promise.all([...changes].map(change => snapshots[change].refresh())).then(() => undefined);
  }

  /**
   * Asks the registry, through the daemon so its credentials apply, what it serves for each
   * reference the installed apps run. Skips local builds and pinned references; an unanswered
   * reference is left out, which {@link Docker.outdated} reads as "don't know".
   */
  async remoteDigests(gap = Docker.RegistryGapMs): Promise<RemoteDigests> {
    const running = await this.runningImages.read();
    const references = [...new Set(running.filter(r => r.digests.length && !Docker.pinned(r.image)).map(r => r.image))];
    const remotes: RemoteDigests = {};

    // Spaced out, since the calls count against a per-IP limit; after a 429 the rest would be
    // refused too, so they stay unknown until the next run.
    for (const [index, image] of references.entries()) {
      if (index > 0) {
        await sleep(gap);
      }

      const digest = await this.remoteDigest(image);

      if (digest === Docker.RateLimited) {
        logger.warn(
          `Registry rate limit hit on ${image} (${index} checked), skipping the remaining ${references.length - index - 1}`,
        );
        break;
      }

      if (digest) {
        remotes[image] = digest;
      }
    }

    return remotes;
  }

  /**
   * Asks the registry about every installed image, then compares its answers with what runs now.
   * @param gap Pause between two registry calls, from the store's `registryThrottling`
   */
  async checkUpdates(gap = Docker.RegistryGapMs): Promise<UpdateCheck> {
    const remotes = await this.remoteDigests(gap);
    const outdated = Docker.outdated(await this.runningImages.read(), remotes);

    return { remotes, outdated };
  }

  /**
   * The apps running an image the registry has moved past. A container counts only when both its
   * local digests and the registry's answer are known.
   * @param running What runs now, from {@link runningImages}
   * @param remotes What the registry served, from {@link remoteDigests}
   */
  static outdated(running: readonly RunningImage[], remotes: RemoteDigests): Set<string> {
    return new Set(
      running
        .filter(({ image, digests }) => {
          const remote = remotes[image];

          return remote !== undefined && digests.length > 0 && !digests.some(d => d.endsWith(`@${remote}`));
        })
        .map(({ project }) => project),
    );
  }

  /**
   * What the registry serves for this reference, `null` when it could not say, or
   * {@link Docker.RateLimited} when it refused to answer at all.
   * @param image The reference as Compose runs it, e.g. `nginx:alpine`
   */
  private async remoteDigest(image: string): Promise<string | null | typeof Docker.RateLimited> {
    try {
      const remote = await this.docker.getImage(image).distribution({ abortSignal: AbortSignal.timeout(10_000) });

      return remote.Descriptor.digest;
    } catch (error) {
      // A rate limit stops the whole run, see the caller.
      if (Docker.rateLimited(error)) {
        return Docker.RateLimited;
      }

      // Unreachable registry, private image with no credentials: both say "don't know".
      logger.warn("Could not check an image for updates", { error, image });

      return null;
    }
  }

  /**
   * Pinned to a digest, or named by id: the reference already denotes one exact image.
   */
  private static pinned(image: string) {
    return image.includes("@sha256:") || image.startsWith("sha256:");
  }

  /**
   * Whether the registry refused the call for asking too often.
   */
  private static rateLimited(error: unknown) {
    return (error as { statusCode?: number })?.statusCode === 429 || /toomanyrequests|429/i.test(String(error));
  }

  /** The load behind {@link overview}: `info` for the containers and version, `df` for the disk usage. */
  private readonly loadOverview = async (): Promise<DockerOverview> => {
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
  };

  /**
   * Fetches the topology (services, containers, ports) of one installed app. No resource usage:
   * that is sampled separately and arrives over the stats stream.
   * An installed app with no container yet resolves to a stopped project with no service.
   * @param project The Compose project name
   * @throws {DockerNotFoundError} if the project is not an installed app
   */
  async projectDetail(project: string): Promise<ComposeProjectDetail> {
    const compose = new ComposeProjects(await this.containers.read(), project);

    return compose.detail(project, this.apps.installedProjectIds());
  }

  /**
   * Opens a following log stream for one container, after verifying it belongs to `project`
   * (so a caller can't read logs from a container outside the project they're authorized for).
   * @param project The Compose project the container is expected to belong to
   * @param containerId The container id; must match {@link Docker.ContainerId} or it's treated as not found
   * @param signal Aborted when the client disconnects; tears the log stream down
   * @throws {DockerNotFoundError} if the id is malformed, missing, or belongs to another project
   */
  async openLogs(project: string, containerId: string, signal: AbortSignal): Promise<Readable> {
    if (!Docker.ContainerId.test(containerId)) {
      throw new DockerNotFoundError(`container ${containerId}`);
    }

    // Looked up within the project, so an id from another project reads as missing: no
    // cross-project probing.
    const compose = new ComposeProjects(await this.containers.read(), project);
    const container = compose.find(containerId);

    if (!container) {
      throw new DockerNotFoundError(`container ${containerId}`);
    }

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
    if (container.detail.Config.Tty) {
      logs.pipe(output);
    } else {
      this.docker.modem.demuxStream(logs, output, output);
    }

    logs.on("end", () => output.end());
    logs.on("error", error => {
      logger.warn("A container log stream failed", { error, container: container.info.Id });
      output.end();
    });
    signal.addEventListener("abort", () => logs.destroy());

    return output;
  }

  /**
   * One sample of every running Compose container, host-wide. Not cached: it feeds a live stream
   * whose callers pace themselves. A container stopping mid-sample must not end the stream.
   */
  async sampleStats(): Promise<Samples> {
    const running = await this.docker.listContainers({ filters: { label: [ComposeProjects.Label.project] } });
    const samples = await Promise.allSettled(
      running.map(
        async entry =>
          [
            entry.Id,
            (await this.docker.getContainer(entry.Id).stats({ stream: false, "one-shot": true })) as unknown,
          ] as const,
      ),
    );

    return new Map(
      fulfilledValues(samples, "sample a container's statistics").map(([id, sample]) => [
        id,
        sample as ContainerStatsSample,
      ]),
    );
  }
}
