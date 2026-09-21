import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { containerSource, dockerMock, fakeApps, fakeDockerode, givenContainers } = await import("./mock/index.ts");
const { Docker } = await import("./docker.ts");
const { DockerNotFoundError } = await import("./compose.ts");

/** Shorthand for the shared fixture, which already defaults to one `alpha`/`web` container. */
const container = containerSource;

/** A client over the given installed apps; `alpha` unless a test says otherwise. */
const client = (...installed: string[]) => new Docker(fakeDockerode(), fakeApps(...installed));

const LABEL = {
  project: "com.docker.compose.project",
  service: "com.docker.compose.service",
  oneoff: "com.docker.compose.oneoff",
};

beforeEach(() => vi.clearAllMocks());

describe("Docker.listProjects", () => {
  it("covers every installed app, including one with no container yet", async () => {
    givenContainers([container()]);

    const { projects } = await client("alpha", "gamma").listProjects();

    expect(projects.map(project => project.name)).toEqual(["alpha", "gamma"]);
    expect(projects[1]).toMatchObject({ status: "stopped", containerCount: 0 });
  });

  it("ignores containers from projects Hangar did not install", async () => {
    givenContainers([
      container(),
      container({ Id: "beta-1", labels: { [LABEL.project]: "beta", [LABEL.service]: "api" } }),
    ]);

    const { projects } = await client("alpha").listProjects();

    expect(projects.map(project => project.name)).toEqual(["alpha"]);
  });
});

describe("Docker.projectDetail", () => {
  it("excludes one-off containers and those without a service label", async () => {
    givenContainers([
      container(),
      container({
        Id: "alpha-run-1",
        labels: { [LABEL.project]: "alpha", [LABEL.service]: "job", [LABEL.oneoff]: "True" },
      }),
      container({ Id: "no-service", labels: { [LABEL.project]: "alpha" } }),
    ]);

    const detail = await client("alpha").projectDetail("alpha");

    expect(detail.services.map(service => service.name)).toEqual(["web"]);
    expect(detail.containerCount).toBe(1);
  });

  it("returns an empty detail for an installed app without containers", async () => {
    givenContainers([]);

    await expect(client("alpha", "gamma").projectDetail("gamma")).resolves.toMatchObject({
      name: "gamma",
      status: "stopped",
      services: [],
      containerIds: [],
    });
  });

  it("rejects a project that is not an installed app", async () => {
    givenContainers([container()]);

    await expect(client("beta").projectDetail("alpha")).rejects.toThrow(DockerNotFoundError);
  });

  it("never samples statistics: the topology must not wait on a CPU delta", async () => {
    givenContainers([container()]);

    const detail = await client("alpha").projectDetail("alpha");

    expect(dockerMock.stats).not.toHaveBeenCalled();
    // The ids are what lets the client pick this app's rows out of the shared stats stream.
    expect(detail.containerIds).toEqual(["container-1"]);
  });

  it("describes the container and keeps only host-published ports", async () => {
    givenContainers([
      container({
        Id: "abcdef0123456789",
        ports: [
          // Exposed but not published: nothing to show the user, and no host port to sort on.
          { IP: "", PrivatePort: 9000, PublicPort: 0, Type: "tcp" },
          { IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
        ],
      }),
    ]);

    const detail = await client("alpha").projectDetail("alpha");
    const [first] = detail.services[0]?.containers ?? [];

    expect(first).toMatchObject({ name: "alpha-web-1", replica: 1, restartCount: 2 });
    expect(first?.ports).toEqual([{ IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8080, Type: "tcp" }]);
  });
});

describe("Docker.openLogs", () => {
  const CONTAINER_ID = "a".repeat(64);
  const signal = new AbortController().signal;
  const logged = (labels: Record<string, string>, tty = false) => containerSource({ Id: CONTAINER_ID, labels, tty });
  const inAlpha = { [LABEL.project]: "alpha", [LABEL.service]: "web" };

  beforeEach(() => {
    dockerMock.logs.mockImplementation(() => Promise.resolve(new PassThrough()));
    // Demuxing is the daemon's framing, not this module's logic: pass the bytes straight through.
    dockerMock.demuxStream.mockImplementation((source: PassThrough, out: PassThrough) => source.pipe(out));
  });

  it("rejects a malformed container id without touching Docker", async () => {
    givenContainers([]);

    await expect(client("alpha").openLogs("alpha", "not-an-id", signal)).rejects.toBeInstanceOf(DockerNotFoundError);
    expect(dockerMock.listContainers).not.toHaveBeenCalled();
  });

  it("rejects a container that does not belong to the requested project", async () => {
    // The project filter means another project's container simply isn't in the list.
    givenContainers([logged({ [LABEL.project]: "beta", [LABEL.service]: "web" })]);

    await expect(client("alpha").openLogs("alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it("rejects a one-off container even inside the right project", async () => {
    givenContainers([logged({ ...inAlpha, [LABEL.oneoff]: "True" })]);

    await expect(client("alpha").openLogs("alpha", CONTAINER_ID, signal)).rejects.toBeInstanceOf(DockerNotFoundError);
  });

  it("follows the container's output from the tail", async () => {
    givenContainers([logged(inAlpha)]);
    const source = new PassThrough();
    dockerMock.logs.mockResolvedValue(source);

    const stream = await client("alpha").openLogs("alpha", CONTAINER_ID, signal);
    source.write("hello\n");

    await expect(new Promise(resolve => stream.once("data", resolve))).resolves.toEqual(Buffer.from("hello\n"));
    expect(dockerMock.logs).toHaveBeenCalledWith(
      CONTAINER_ID,
      expect.objectContaining({ follow: true, stdout: true, stderr: true, tail: 200, timestamps: true }),
    );
  });

  it("demuxes a non-TTY container and pipes a TTY one straight through", async () => {
    givenContainers([logged(inAlpha)]);
    await client("alpha").openLogs("alpha", CONTAINER_ID, signal);
    expect(dockerMock.demuxStream).toHaveBeenCalled();

    vi.clearAllMocks();
    dockerMock.logs.mockResolvedValue(new PassThrough());
    givenContainers([logged(inAlpha, true)]);

    await client("alpha").openLogs("alpha", CONTAINER_ID, signal);
    expect(dockerMock.demuxStream).not.toHaveBeenCalled();
  });

  it("tears the log stream down when the request is aborted", async () => {
    givenContainers([logged(inAlpha)]);
    const source = new PassThrough();
    dockerMock.logs.mockResolvedValue(source);
    const controller = new AbortController();

    await client("alpha").openLogs("alpha", CONTAINER_ID, controller.signal);
    controller.abort();

    expect(source.destroyed).toBe(true);
  });
});

describe("Docker.sampleStats", () => {
  it("samples every running Compose container, keyed by full id", async () => {
    givenContainers([
      container(),
      container({ Id: "container-2", labels: { [LABEL.project]: "beta", [LABEL.service]: "api" } }),
    ]);
    dockerMock.stats.mockImplementation((id: string) => Promise.resolve({ id }));

    const samples = await client("alpha").sampleStats();

    // The whole host, not just installed apps: the caller picks the ids it is showing.
    expect([...samples.keys()]).toEqual(["container-1", "container-2"]);
    expect(dockerMock.stats).toHaveBeenCalledWith("container-1", { stream: false, "one-shot": true });
  });
});

describe("Docker.imageUpdates", () => {
  /** The local image carries `digest` as its registry digest, and the registry serves `remote`. */
  const givenDigests = (digest: string | null, remote = "sha256:remote") => {
    dockerMock.imageInspect.mockResolvedValue({ RepoDigests: digest ? [`nginx@${digest}`] : [] });
    dockerMock.distribution.mockResolvedValue({ Descriptor: { digest: remote } });
  };

  it("reports an image the registry has moved past", async () => {
    givenContainers([container()]);
    givenDigests("sha256:local");

    expect(await client("alpha").imageUpdates()).toEqual([
      { project: "alpha", image: "nginx:alpine", status: "outdated" },
    ]);
  });

  it("reports an image the registry still serves as current", async () => {
    givenContainers([container()]);
    givenDigests("sha256:same", "sha256:same");

    expect(await client("alpha").imageUpdates()).toEqual([
      { project: "alpha", image: "nginx:alpine", status: "current" },
    ]);
  });

  it("does not claim an update for an image built here, which has no registry digest", async () => {
    givenContainers([container()]);
    givenDigests(null);

    expect(await client("alpha").imageUpdates()).toEqual([
      { project: "alpha", image: "nginx:alpine", status: "unknown" },
    ]);
    expect(dockerMock.distribution).not.toHaveBeenCalled();
  });

  it("does not claim an update when the registry cannot be reached", async () => {
    givenContainers([container()]);
    dockerMock.imageInspect.mockResolvedValue({ RepoDigests: ["nginx@sha256:local"] });
    dockerMock.distribution.mockRejectedValue(new Error("toomanyrequests"));

    expect(await client("alpha").imageUpdates()).toEqual([
      { project: "alpha", image: "nginx:alpine", status: "unknown" },
    ]);
  });

  it("leaves a digest-pinned reference alone: it already names one exact image", async () => {
    givenContainers([container({ image: "nginx@sha256:pinned" })]);

    expect(await client("alpha").imageUpdates()).toEqual([
      { project: "alpha", image: "nginx@sha256:pinned", status: "current" },
    ]);
    expect(dockerMock.imageInspect).not.toHaveBeenCalled();
    expect(dockerMock.distribution).not.toHaveBeenCalled();
  });

  it("asks the registry once for a reference two projects share, and answers for both", async () => {
    givenContainers([
      container(),
      container({ Id: "container-2", labels: { [LABEL.project]: "beta", [LABEL.service]: "web" } }),
    ]);
    givenDigests("sha256:local");

    const updates = await client("alpha", "beta").imageUpdates();

    expect(updates.map(update => update.project)).toEqual(["alpha", "beta"]);
    expect(updates.every(update => update.status === "outdated")).toBe(true);
    expect(dockerMock.distribution).toHaveBeenCalledTimes(1);
  });

  it("ignores images from projects Hangar did not install", async () => {
    givenContainers([container({ Id: "beta-1", labels: { [LABEL.project]: "beta", [LABEL.service]: "web" } })]);
    givenDigests("sha256:local");

    expect(await client("alpha").imageUpdates()).toEqual([]);
  });
});

describe("Docker.overview", () => {
  it("reports the host's containers, images and volumes", async () => {
    dockerMock.info.mockResolvedValue({
      ServerVersion: "27.3.1",
      Containers: 5,
      ContainersRunning: 4,
      ContainersStopped: 1,
    });
    dockerMock.df.mockResolvedValue({
      LayersSize: 1_073_741_824,
      Images: [{ Containers: 2 }, { Containers: 0 }],
      Volumes: [{ UsageData: { RefCount: 1 } }, { UsageData: { RefCount: 0 } }, { UsageData: null }],
    });

    expect(await client().overview()).toEqual({
      version: "27.3.1",
      containers: { total: 5, running: 4, stopped: 1 },
      images: { total: 2, unused: 1, size: 1_073_741_824 },
      volumes: { total: 3, inUse: 1, unused: 2 },
    });
  });

  it("survives a daemon that reports neither images nor volumes", async () => {
    dockerMock.info.mockResolvedValue({
      ServerVersion: "27.3.1",
      Containers: 0,
      ContainersRunning: 0,
      ContainersStopped: 0,
    });
    dockerMock.df.mockResolvedValue({ LayersSize: 0, Images: null, Volumes: null });

    const overview = await client().overview();

    expect(overview.images).toEqual({ total: 0, unused: 0, size: 0 });
    expect(overview.volumes).toEqual({ total: 0, inUse: 0, unused: 0 });
  });
});

describe("Docker container sweeps", () => {
  it("serves one daemon sweep to concurrent callers and to the next render", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await Promise.all([docker.listProjects(), docker.listProjects()]);
    await docker.listProjects();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
  });

  it("serves the same sweep to the apps list and to one project's detail", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await docker.listProjects();
    await docker.projectDetail("alpha");

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
  });

  it("keeps the containers it could inspect when one has gone away mid-sweep", async () => {
    const sources = [container(), container({ Id: "container-2", name: "/alpha-web-2" })];
    givenContainers(sources);

    // A container that exits between the list and its inspect answers 404, which is the common
    // case right after a `compose down` — not a reason to fail the whole page.
    dockerMock.inspect.mockImplementation((id: string) =>
      id === "container-2"
        ? Promise.reject(new Error("no such container"))
        : Promise.resolve(sources.find(entry => entry.info.Id === id)?.detail),
    );

    const { projects } = await client("alpha").listProjects();

    expect(projects[0]).toMatchObject({ name: "alpha", containerCount: 1 });
  });

  it("asks again once the sweep has expired", async () => {
    givenContainers([container()]);
    const docker = new Docker(fakeDockerode(), fakeApps("alpha"), 0);

    await docker.listProjects();
    await docker.listProjects();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });

  it("asks again after a Compose command invalidates it", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await docker.listProjects();
    docker.invalidate();
    await docker.listProjects();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed sweep", async () => {
    const docker = client("alpha");
    dockerMock.listContainers.mockRejectedValueOnce(new Error("socket gone"));

    await expect(docker.listProjects()).rejects.toThrow("socket gone");
    givenContainers([container()]);

    await expect(docker.listProjects()).resolves.toMatchObject({ projects: [{ name: "alpha" }] });
  });
});

describe("Docker snapshot staleness", () => {
  /** A fixed point to move away from; the cache reads the clock, nothing here is on a timer. */
  const START = 1_700_000_000_000;

  /** Only `Date` is faked: every `await` in here still settles on real microtasks. */
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(START));

  afterEach(() => {
    vi.useRealTimers();
    dockerMock.info.mockReset();
    dockerMock.df.mockReset();
  });

  /** The two calls `overview` makes, answering with the given daemon version. */
  const givenDaemon = (version: string) => {
    dockerMock.info.mockResolvedValue({
      ServerVersion: version,
      Containers: 1,
      ContainersRunning: 1,
      ContainersStopped: 0,
    });
    dockerMock.df.mockResolvedValue({ LayersSize: 0, Images: null, Volumes: null });
  };

  it("serves a stale overview at once and refreshes behind it", async () => {
    const docker = client("alpha");
    givenDaemon("27.3.1");

    expect((await docker.overview()).version).toBe("27.3.1");

    givenDaemon("28.0.0");
    vi.setSystemTime(START + 61_000);

    // Past its TTL but inside the grace window: the caller gets the snapshot without waiting on
    // the daemon, and the reload goes out behind it.
    expect((await docker.overview()).version).toBe("27.3.1");
    expect(dockerMock.df).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(dockerMock.df).toHaveBeenCalledTimes(2));

    expect((await docker.overview()).version).toBe("28.0.0");
  });

  it("stops serving a stale overview once the daemon has been down past the grace window", async () => {
    const docker = client("alpha");
    givenDaemon("27.3.1");
    await docker.overview();

    dockerMock.info.mockRejectedValue(new Error("socket gone"));
    dockerMock.df.mockRejectedValue(new Error("socket gone"));

    // Inside the grace window the failed reload puts the snapshot back, timestamp and all...
    vi.setSystemTime(START + 61_000);
    await expect(docker.overview()).resolves.toMatchObject({ version: "27.3.1" });

    // ...so it keeps ageing, and past it the caller gets the daemon's real error instead.
    vi.setSystemTime(START + 400_000);
    await expect(docker.overview()).rejects.toThrow("socket gone");
  });

  it("serves a stale sweep at once rather than waiting on the daemon", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await docker.listProjects();
    vi.setSystemTime(START + 6_000);
    await docker.listProjects();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });
});
