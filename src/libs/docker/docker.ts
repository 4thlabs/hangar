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
import { join, Snapshots, type Snapshot } from "#libs/cache";
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

  /**
   * How long past its TTL a sweep is still handed out while it reloads behind the caller. Comfortably
   * longer than the warm loop's tick, so a page render still finds a snapshot when a tick runs late
   * or fails — the moment it does not, `/apps` goes back to waiting on the daemon.
   */
  private static readonly GRACE = 120_000;

  /** `df` is the slowest call the daemon has, and these counts move slowly. */
  private static readonly OVERVIEW_TTL = 300_000;

  /** Longer grace than the sweep: nothing here changes fast enough to be worth blocking a paint. */
  private static readonly OVERVIEW_GRACE = 3_600_000;

  /** The daemon reads this client serves from a snapshot. */
  private readonly snapshots = new Snapshots();

  /**
   * One sweep of every Compose-labeled container, in both API views. One read for everyone: the
   * apps list, one project's detail and a log stream all narrow this in memory through
   * `ComposeProjects` rather than asking the daemon again.
   */
  private readonly containers: Snapshot<ComposeContainerSource[]>;

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
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param apps The installed-app lookup, satisfied by `hangar.store`
   * @param ttl How long a container sweep is reused; injected so a test can drive it
   */
  constructor(docker: Dockerode, apps: InstalledApps, ttl = Docker.TTL) {
    this.docker = docker;
    this.apps = apps;
    this.containers = this.snapshots.define("containers", ttl, Docker.GRACE, this.sweep);
    this.projects = join(this.containers, sources => ({
      projects: new ComposeProjects(sources).summaries(this.apps.installedProjectIds()),
    }));
  }

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
      filters: { label: [ComposeProjects.LABEL.project] },
    });
    const inspected = await Promise.allSettled(
      listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })),
    );

    return inspected.filter(result => result.status === "fulfilled").map(result => result.value);
  };

  /**
   * Drops every cached daemon read. Called after a Compose command, which is the one moment the
   * page behind it is guaranteed to ask again and must not be told what was true before. The
   * overview goes too: a compose command changes the container counts `info` reports.
   *
   * Does not reach the dashboard's Docker widget, which caches its own render one layer up: its
   * counts stay up to a widget TTL stale after a compose command. Compose runs from `/apps`, not
   * the dashboard, and wiring the two caches together would couple the libraries over a badge.
   */
  invalidate() {
    this.snapshots.clear();
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
    const pairs = new Map<string, { project: string; image: string; imageId: string }>();

    // Keyed by the running image too, not only the reference: a pull moves the tag while the
    // containers keep the image they were created with, so two of them on one tag can differ.
    for (const { info } of await this.containers.read()) {
      const project = info.Labels[ComposeProjects.LABEL.project] ?? "";
      const pair = { project, image: info.Image, imageId: info.ImageID };

      if (installed.has(project)) pairs.set(`${project}\u0000${info.Image}\u0000${info.ImageID}`, pair);
    }

    const running = [...pairs.values()];

    // Local first, and it decides who gets a registry call: an image built here carries no
    // registry digest to compare against, and asking about it would spend a rate-limited round
    // trip to learn nothing.
    const ids = [...new Set(running.map(pair => pair.imageId))];
    const locals = new Map(await Promise.all(ids.map(async id => [id, await this.localDigests(id)] as const)));

    const references = [...new Set(running.filter(pair => locals.get(pair.imageId)?.length).map(pair => pair.image))];
    const remotes = new Map(
      await Promise.all(references.map(async image => [image, await this.remoteDigest(image)] as const)),
    );

    return running.map(({ project, image, imageId }) => ({
      project,
      image,
      status: Docker.imageStatus(image, locals.get(imageId) ?? null, remotes.get(image) ?? null),
    }));
  }

  /**
   * The registry digests of the image a container is *running*, looked up by id and never by
   * reference. `docker compose pull` moves the tag and leaves the containers on the image they
   * were created with, so resolving the tag would report an app current while it still runs the
   * old one — and the tag is what Hangar itself moves, every time it pulls.
   *
   * `null` when the image could not be read; an empty list when it was never pulled.
   */
  private async localDigests(imageId: string): Promise<string[] | null> {
    // Compose never filled it in, or the daemon did not report one: nothing to inspect.
    if (!imageId) return null;

    try {
      return (await this.docker.getImage(imageId).inspect()).RepoDigests ?? [];
    } catch (error) {
      logger.warn("Could not read the image a container runs", { error, imageId });

      return null;
    }
  }

  /**
   * What the registry serves for this reference, or `null` when it could not say.
   * One call per reference: replicas of a service share an image, and two apps may share one too.
   * @param image The reference as Compose runs it, e.g. `nginx:alpine`
   */
  private async remoteDigest(image: string): Promise<string | null> {
    // Pinned to a digest, or named by id: the reference already denotes one exact image.
    if (image.includes("@sha256:") || image.startsWith("sha256:")) return null;

    try {
      const remote = await this.docker.getImage(image).distribution({ abortSignal: AbortSignal.timeout(10_000) });

      return remote.Descriptor.digest;
    } catch (error) {
      // Unreachable registry, rate limit, private image with no credentials: all say "don't know".
      logger.warn("Could not check an image for updates", { error, image });

      return null;
    }
  }

  /**
   * One container's verdict, from what it runs and what the registry serves. Pure: both lookups
   * already happened, which is what lets them be batched and deduplicated above.
   */
  private static imageStatus(image: string, local: string[] | null, remote: string | null): ImageUpdateStatus {
    // Pinned to a digest, or named by id: the reference already denotes one exact image.
    if (image.includes("@sha256:") || image.startsWith("sha256:")) return "current";

    // Unreadable image, one built here rather than pulled, or a registry that could not answer.
    if (!local?.length || !remote) return "unknown";

    return local.some(digest => digest.endsWith(`@${remote}`)) ? "current" : "outdated";
  }

  /**
   * Host-wide counts for the local daemon: the whole engine, not just the apps Hangar installed,
   * so the dashboard reports the local environment the way Arcane reports a remote one.
   *
   * Two endpoints because neither answers alone: `info` carries the container tallies and the
   * daemon version, `df` the disk usage (which images nothing runs, which volumes nothing mounts).
   */
  overview(): Promise<DockerOverview> {
    return this.snapshots.read("overview", Docker.OVERVIEW_TTL, Docker.OVERVIEW_GRACE, async () => {
      const [info, usage] = (await Promise.all([this.docker.info(), this.docker.df()])) as [
        SystemInfo,
        SystemDiskUsage,
      ];
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
    });
  }

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
   * @param containerId The container id; must match {@link Docker.CONTAINER_ID} or it's treated as not found
   * @param signal Aborted when the client disconnects; tears the log stream down
   * @throws {DockerNotFoundError} if the id is malformed, missing, or belongs to another project
   */
  async openLogs(project: string, containerId: string, signal: AbortSignal): Promise<Readable> {
    if (!Docker.CONTAINER_ID.test(containerId)) throw new DockerNotFoundError(`container ${containerId}`);

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
    const running = await this.docker.listContainers({ filters: { label: [ComposeProjects.LABEL.project] } });
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
