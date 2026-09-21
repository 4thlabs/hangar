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

/** One cached read: the promise as it was handed out, and when it stops being fresh. */
type CacheEntry = { value: Promise<unknown>; until: number };

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
   * How long past its TTL a sweep is still handed out while it reloads behind the caller. Sized
   * to the apps page's own 30s `AutoReload`: a reader never waits on the daemon, and never sees
   * anything older than one reload of what it was going to be shown anyway.
   */
  private static readonly GRACE = 30_000;

  /** The host counts move slowly, and the dashboard reads them once per visit, not on a timer. */
  private static readonly OVERVIEW_TTL = 60_000;

  /** Longer grace than the sweep: nothing here changes fast enough to be worth blocking a paint. */
  private static readonly OVERVIEW_GRACE = 300_000;

  /** How long a settled sweep is served again, in milliseconds. */
  private readonly ttl: number;

  /** One entry per cached read. See {@link cached}. */
  private readonly cache = new Map<string, CacheEntry>();

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
   * Serves a daemon read from the last snapshot, and refreshes it behind the caller once it goes
   * stale. A read inside `ttl` is the snapshot; a read within `grace` past it is *still* the
   * snapshot, handed back at once with a reload started behind it; past that the caller waits on
   * the daemon and gets its error. Nothing is on a timer, so nobody reading means nothing asking.
   *
   * `grace` therefore has one plain meaning: how long a dead daemon stays hidden. A reload that
   * fails restores the entry it replaced, timestamp and all, so the snapshot keeps ageing and the
   * next read past `ttl + grace` surfaces the real error rather than a stale answer forever.
   *
   * Only raw daemon reads belong in here, never anything derived: {@link DockerNotFoundError} is
   * thrown downstream of the sweep, by `ComposeProjects`, so a 404 can never be cached.
   *
   * ponytail: while a reload is in flight the slot holds *its* promise, so a second reader
   * arriving inside that window waits on it instead of getting the snapshot. One reader per
   * render, one window per reload. Split the slot into `{ settled, inflight }` if that ever shows.
   *
   * @param key Which read this is; also the unit {@link invalidate} drops
   * @param ttl How long the value is fresh, in milliseconds
   * @param grace How long past `ttl` it is still served while reloading
   * @param load Fetches a new value from the daemon
   */
  private cached<T>(key: string, ttl: number, grace: number, load: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry && now < entry.until) return entry.value as Promise<T>;

    // Stale but inside the grace window: hand back what we have, reload behind it. The floating
    // promise is safe only because `refresh` attaches its own handler to it — without that, a
    // daemon restart would surface as an unhandled rejection, which by default kills the process.
    if (entry && now < entry.until + grace) {
      void this.refresh(key, entry, ttl, load);

      return entry.value as Promise<T>;
    }

    return this.refresh(key, entry, ttl, load);
  }

  /**
   * Loads a fresh value into `key` and publishes it once it settles.
   *
   * Both handlers check they still own the slot before touching it: a load started before an
   * {@link invalidate} can settle after it, and must not publish what the compose command just
   * made untrue.
   *
   * @param previous The entry being replaced, restored as-is if the load fails
   */
  private refresh<T>(key: string, previous: CacheEntry | undefined, ttl: number, load: () => Promise<T>): Promise<T> {
    const value = load();
    const entry: CacheEntry = { value, until: Number.POSITIVE_INFINITY };

    // In flight it never expires, so concurrent callers share one round trip; staleness only
    // starts once it has settled.
    this.cache.set(key, entry);

    value.then(
      () => {
        if (this.cache.get(key) === entry) entry.until = Date.now() + ttl;
      },
      () => {
        if (this.cache.get(key) !== entry) return;
        if (previous) this.cache.set(key, previous);
        else this.cache.delete(key);
      },
    );

    return value;
  }

  /**
   * Lists every Compose-labeled container on the host, in both API views. One sweep for everyone:
   * the apps list, one project's detail and a log stream all read the same snapshot, because the
   * callers that want one project narrow it in memory through `ComposeProjects`.
   *
   * An inspect costs a few milliseconds over the socket, so they all go out at once — and with
   * `allSettled`, because a container that exits between the list and its inspect answers 404,
   * and one container going away must not cost the whole sweep. That is the common case right
   * after a `compose down`, not an edge one.
   */
  private inspectContainers(): Promise<ComposeContainerSource[]> {
    return this.cached("containers", this.ttl, Docker.GRACE, async () => {
      const listed = await this.docker.listContainers({
        all: true,
        filters: { label: [ComposeProjects.LABEL.project] },
      });
      const inspected = await Promise.allSettled(
        listed.map(async info => ({ info, detail: await this.docker.getContainer(info.Id).inspect() })),
      );

      return inspected.filter(result => result.status === "fulfilled").map(result => result.value);
    });
  }

  /**
   * Drops every cached daemon read. Called after a Compose command, which is the one moment the
   * page behind it is guaranteed to ask again and must not be told what was true before. The
   * overview goes too: a compose command changes the container counts `info` reports.
   */
  invalidate() {
    this.cache.clear();
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
  overview(): Promise<DockerOverview> {
    return this.cached("overview", Docker.OVERVIEW_TTL, Docker.OVERVIEW_GRACE, async () => {
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
   * Lists every app Hangar installed, as lightweight summaries of their Docker state.
   *
   * ponytail: the sweep inspects every Compose container on the host and throws away the ones
   * Hangar did not install. There is no daemon-side fix: Docker ANDs repeated `label` filters, so
   * asking for several projects at once matches a container in *all* of them, i.e. nothing.
   * Narrowing would mean one list call per installed project, which is worse. Left as is.
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
    const compose = new ComposeProjects(await this.inspectContainers(), project);

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
    const compose = new ComposeProjects(await this.inspectContainers(), project);
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
