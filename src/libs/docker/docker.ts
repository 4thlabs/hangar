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
} from "./compose.ts";
import { logger } from "#libs/logs";
import { Cache, type Snapshot } from "#libs/cache";
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
 * What a daemon event can make stale: the Compose container sweep, the local image list, or the
 * host-wide overview. See {@link Docker.refresh} and `DockerEvents`.
 */
export type DockerChange = "containers" | "images" | "overview";

/** Every {@link DockerChange}, for a caller that cannot tell which one happened. */
export const DockerChanges: readonly DockerChange[] = ["containers", "images", "overview"];

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
  private static readonly ContainerId = /^[a-f0-9]{12,64}$/i;

  /**
   * Pause between two registry calls. The daemon asks the registry once per call, and Docker Hub
   * and ghcr.io both rate-limit a burst from one IP.
   * ponytail: a single gap shared by every registry, not a bucket per registry. Split them if a
   * host that mixes Hub and ghcr makes the check noticeably slow.
   */
  private static readonly RegistryGapMs = 100;

  /** What {@link Docker.remoteDigest} returns once the registry says "too many requests". */
  private static readonly RateLimited = Symbol("rate-limited");

  /** The Engine API client. */
  private readonly docker: Dockerode;

  /** What Hangar installed; read per call, so a freshly installed app shows up without a restart. */
  private readonly apps: InstalledApps;

  /**
   * Default {@link ttl}. Liveness is not its job: `DockerEvents` refreshes the sweep the moment the
   * daemon reports a change. This is the net for a change the stream never reported — an action
   * the filter misses, or a stream gone quiet without dropping — and a minute bounds that, while
   * the warm loop no longer re-sweeps on every tick for nothing.
   */
  private static readonly Ttl = 60_000;

  /**
   * How long past its TTL a sweep is still handed out while it reloads behind the caller. Comfortably
   * longer than the warm loop's tick, so a page render still finds a snapshot when a tick runs late
   * or fails — the moment it does not, `/apps` goes back to waiting on the daemon.
   */
  private static readonly Grace = 120_000;

  /**
   * `df` is the slowest call the daemon has, and every event that moves these counts refreshes them
   * anyway; this is the same net as {@link Ttl}, looser because only the dashboard reads it.
   */
  private static readonly OverviewTtl = 300_000;

  /** Longer grace than the sweep: nothing here changes fast enough to be worth blocking a paint. */
  private static readonly OverviewGrace = 3_600_000;

  /** The daemon reads this client serves from a snapshot. */
  private readonly cache = new Cache();

  /**
   * One sweep of every Compose-labeled container, in both API views. One read for everyone: the
   * apps list, one project's detail and a log stream all narrow this in memory through
   * `ComposeProjects` rather than asking the daemon again.
   */
  private readonly containers: Snapshot<ComposeContainerSource[]>;

  /** The registry digests of every local image, by image id; see {@link listImages}. */
  private readonly images: Snapshot<Map<string, string[]>>;

  /**
   * Every app Hangar installed, as lightweight summaries of their Docker state.
   *
   * Public as the handle rather than as a `listProjects()` / `peekProjects()` pair: those were one
   * read described twice, and each rebuilt the projection in its own words. A caller that can wait
   * calls `read()`, one that must not calls `peek()`, and both are the same declaration.
   *
   * ponytail: the sweep inspects every Compose container on the host and throws away the ones
   * Hangar did not install. There is no daemon-side fix: Docker ANDs repeated `label` filters, so
   * asking for several projects at once matches a container in *all* of them, i.e. nothing.
   * Narrowing would mean one list call per installed project, which is worse. Left as is.
   */
  readonly projects: Snapshot<ComposeProjectsSnapshot>;

  /**
   * Every container of an installed app, with the registry digests of the image it runs — what
   * {@link Docker.outdated} compares the last check against.
   *
   * Over the same sweep as {@link projects}, so a change that refreshes one moves the other: the
   * badge goes the moment the containers it was about do.
   */
  readonly runningImages: Snapshot<RunningImage[]>;

  /**
   * Host-wide counts for the local daemon: the whole engine, not just the apps Hangar installed,
   * so the dashboard reports the local environment the way Arcane reports a remote one.
   *
   * A handle like {@link projects} rather than a method, so the dashboard widget renders straight
   * from it instead of caching a second copy with its own TTL to fall out of step.
   */
  readonly overview: Snapshot<DockerOverview>;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param apps The installed-app lookup, satisfied by `hangar.store`
   * @param ttl How long a container sweep is reused; injected so a test can drive it
   */
  constructor(docker: Dockerode, apps: InstalledApps, ttl = Docker.Ttl) {
    this.docker = docker;
    this.apps = apps;
    this.containers = this.cache.define("containers", ttl, Docker.Grace, this.sweep);
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
   * The registry digests of every local image, by image id. One call for the whole host rather
   * than an inspect per image: the list already carries `RepoDigests`.
   *
   * Never rejects: the digests only feed the update badge, which is an extra, never a reason for
   * the Apps page to fail. An unreadable list leaves every app without a badge until the next one.
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
   * The sweep behind {@link containers}.
   *
   * An inspect costs a few milliseconds over the socket, so they all go out at once — and with
   * `allSettled`, because a container that exits between the list and its inspect answers 404,
   * and one container going away must not cost the whole sweep. That is the common case right
   * after a `compose down`, not an edge one.
   */
  private readonly sweep = async (): Promise<ComposeContainerSource[]> => {
    const listed = await this.docker.listContainers({
      all: true,
      filters: { label: [ComposeProjects.Label.project] },
    });
    const inspected = await Promise.allSettled(
      listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })),
    );

    return inspected.filter(result => result.status === "fulfilled").map(result => result.value);
  };

  /**
   * Reloads the daemon reads a change made stale, while every reader keeps the current snapshot
   * until the new one lands — so a page rendered meanwhile still paints at once.
   *
   * `DockerEvents` calls this for whatever the daemon reports, whoever caused it: a Compose command
   * from the web, the CLI or a job, or a container that crashed on its own. A caller that is about
   * to read the new state awaits it instead, as the Compose stream does before the page reloads.
   *
   * @param changes What went stale; everything when the caller cannot tell
   * @returns Settles once each reload has, and never rejects
   */
  refresh(changes: Iterable<DockerChange> = DockerChanges): Promise<void> {
    const snapshots = { containers: this.containers, images: this.images, overview: this.overview };

    return Promise.all([...changes].map(change => snapshots[change].refresh())).then(() => undefined);
  }

  /**
   * Asks the registry what it serves for every reference the installed apps run. The daemon does
   * the talking (`/distribution/{name}/json`), so its own registry credentials apply and nothing
   * here handles auth.
   *
   * One call per *reference*: replicas of a service share an image, and two apps may share one
   * too. Only for images that carry a registry digest — one built here has nothing to compare
   * against, and asking about it would spend a rate-limited round trip to learn nothing. A
   * reference the registry could not answer for is left out, which {@link Docker.outdated} reads
   * as "don't know", never as a false "update available".
   */
  async remoteDigests(gap = Docker.RegistryGapMs): Promise<RemoteDigests> {
    const running = await this.runningImages.read();
    const references = [...new Set(running.filter(r => r.digests.length && !Docker.pinned(r.image)).map(r => r.image))];
    const remotes: RemoteDigests = {};

    // One at a time and spaced out, not a burst: the calls count against a per-IP limit. Once the
    // registry says "too many requests", every call after it would be refused too and would
    // still spend quota, so the rest stay unknown until the next run.
    for (const [index, image] of references.entries()) {
      if (index > 0) await sleep(gap);

      const digest = await this.remoteDigest(image);

      if (digest === Docker.RateLimited) {
        // In the message, not in metadata: the log format only ever prints `message` and `error`.
        logger.warn(
          `Registry rate limit hit on ${image} (${index} checked), skipping the remaining ${references.length - index - 1}`,
        );
        break;
      }

      if (digest) remotes[image] = digest;
    }

    return remotes;
  }

  /**
   * The apps running an image the registry has moved past. Pure, so it can sit in a
   * `Cache.join` and be recomputed on every read against whatever runs now.
   *
   * A container counts only when both sides are known: an image with no registry digest, or a
   * reference the registry was not asked about (pinned, rate-limited, unreachable), is no claim
   * either way.
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
   * One call per reference: replicas of a service share an image, and two apps may share one too.
   * @param image The reference as Compose runs it, e.g. `nginx:alpine`
   */
  private async remoteDigest(image: string): Promise<string | null | typeof Docker.RateLimited> {
    try {
      const remote = await this.docker.getImage(image).distribution({ abortSignal: AbortSignal.timeout(10_000) });

      return remote.Descriptor.digest;
    } catch (error) {
      // A rate limit stops the whole run, see the caller.
      if (Docker.rateLimited(error)) return Docker.RateLimited;

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

  /**
   * The load behind {@link overview}.
   *
   * Two endpoints because neither answers alone: `info` carries the container tallies and the
   * daemon version, `df` the disk usage (which images nothing runs, which volumes nothing mounts).
   */
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
    if (!Docker.ContainerId.test(containerId)) throw new DockerNotFoundError(`container ${containerId}`);

    // Narrowing to the project, rather than inspecting the id directly, means an id from another
    // project is indistinguishable from one that doesn't exist: no cross-project probing. The
    // filter is `ComposeProjects`' rather than the daemon's, and `find` only ever searches what it
    // kept, so the guarantee is the same one — it just no longer costs its own sweep.
    const compose = new ComposeProjects(await this.containers.read(), project);
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
   *
   * Not cached: this is the source of a live stream, and its callers already pace themselves.
   * `allSettled` because a container stopping mid-sample answers 404, and one exiting container
   * must not end the stats stream for every open tab.
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
      samples
        .filter(sample => sample.status === "fulfilled")
        .map(sample => [sample.value[0], sample.value[1] as ContainerStatsSample]),
    );
  }
}
