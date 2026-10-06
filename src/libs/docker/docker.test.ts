import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The pause between registry calls is real seconds in production; here it is only an ordering point.
vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

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

describe("Docker.projects", () => {
  it("covers every installed app, including one with no container yet", async () => {
    givenContainers([container()]);

    const { projects } = await client("alpha", "gamma").projects.read();

    expect(projects.map(project => project.name)).toEqual(["alpha", "gamma"]);
    expect(projects[1]).toMatchObject({ status: "stopped", containerCount: 0 });
  });

  it("ignores containers from projects Hangar did not install", async () => {
    givenContainers([
      container(),
      container({ Id: "beta-1", labels: { [LABEL.project]: "beta", [LABEL.service]: "api" } }),
    ]);

    const { projects } = await client("alpha").projects.read();

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

describe("Docker.remoteDigests", () => {
  /** Every local image carries `digests` as its registry digests. */
  const givenImages = (...digests: string[]) =>
    dockerMock.listImages.mockResolvedValue([{ Id: "sha256:running", RepoDigests: digests }]);

  it("asks the registry once per reference, for images that carry a registry digest", async () => {
    givenContainers([
      container(),
      container({ Id: "container-2", labels: { [LABEL.project]: "beta", [LABEL.service]: "web" } }),
    ]);

    givenImages("nginx@sha256:local");
    dockerMock.distribution.mockResolvedValue({ Descriptor: { digest: "sha256:remote" } });

    expect(await client("alpha", "beta").remoteDigests()).toEqual({ "nginx:alpine": "sha256:remote" });
    expect(dockerMock.distribution).toHaveBeenCalledTimes(1);
  });

  it("does not ask about an image built here, which has no registry digest", async () => {
    givenContainers([container()]);
    givenImages();

    expect(await client("alpha").remoteDigests()).toEqual({});
    expect(dockerMock.distribution).not.toHaveBeenCalled();
  });

  it("leaves a digest-pinned reference alone: it already names one exact image", async () => {
    givenContainers([container({ image: "nginx@sha256:pinned" })]);
    givenImages("nginx@sha256:pinned");

    expect(await client("alpha").remoteDigests()).toEqual({});
    expect(dockerMock.distribution).not.toHaveBeenCalled();
  });

  it("asks the registry one image at a time, never in a burst", async () => {
    givenContainers(["a", "b", "c"].map(n => container({ Id: n, image: `${n}:latest` })));
    givenImages("x@sha256:local");
    let inFlight = 0;
    let peak = 0;

    dockerMock.distribution.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;

      return { Descriptor: { digest: "sha256:remote" } };
    });

    await client("alpha").remoteDigests();

    expect(dockerMock.distribution).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it("stops asking once the registry rate-limits", async () => {
    givenContainers(["a", "b", "c"].map(n => container({ Id: n, image: `${n}:latest` })));
    givenImages("x@sha256:local");
    dockerMock.distribution.mockRejectedValue(new Error("toomanyrequests: You have reached your pull rate limit"));

    expect(await client("alpha").remoteDigests()).toEqual({});
    expect(dockerMock.distribution).toHaveBeenCalledTimes(1);
  });

  it("keeps asking past a registry that is only unreachable", async () => {
    givenContainers(["a", "b"].map(n => container({ Id: n, image: `${n}:latest` })));
    givenImages("x@sha256:local");
    dockerMock.distribution
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce({ Descriptor: { digest: "sha256:remote" } });

    expect(await client("alpha").remoteDigests()).toEqual({ "b:latest": "sha256:remote" });
  });

  it("ignores images from projects Hangar did not install", async () => {
    givenContainers([container({ Id: "beta-1", labels: { [LABEL.project]: "beta", [LABEL.service]: "web" } })]);
    givenImages("nginx@sha256:local");

    expect(await client("alpha").remoteDigests()).toEqual({});
  });
});

describe("Docker.runningImages", () => {
  it("reads the image the container runs, not what its tag points at now", async () => {
    givenContainers([container()]);
    // A pull moves `nginx:alpine` onto the new image while the container keeps the old one:
    // resolving the reference would call it current, which is the whole bug.
    dockerMock.listImages.mockResolvedValue([
      { Id: "sha256:running", RepoDigests: ["nginx@sha256:before"] },
      { Id: "sha256:pulled", RepoDigests: ["nginx@sha256:remote"] },
    ]);

    expect(await client("alpha").runningImages.read()).toEqual([
      { project: "alpha", image: "nginx:alpine", digests: ["nginx@sha256:before"] },
    ]);
  });

  it("answers without digests rather than failing when the images cannot be listed", async () => {
    givenContainers([container()]);
    dockerMock.listImages.mockRejectedValue(new Error("daemon gone"));

    expect(await client("alpha").runningImages.read()).toEqual([
      { project: "alpha", image: "nginx:alpine", digests: [] },
    ]);
  });
});

describe("Docker.outdated", () => {
  const running = (project: string, image: string, ...digests: string[]) => ({ project, image, digests });

  it("flags an app whose running image the registry has moved past", () => {
    const outdated = Docker.outdated([running("alpha", "nginx:alpine", "nginx@sha256:local")], {
      "nginx:alpine": "sha256:remote",
    });

    expect([...outdated]).toEqual(["alpha"]);
  });

  it("clears it once the app runs what the registry serves", () => {
    const outdated = Docker.outdated([running("alpha", "nginx:alpine", "nginx@sha256:remote")], {
      "nginx:alpine": "sha256:remote",
    });

    expect([...outdated]).toEqual([]);
  });

  it("separates two apps on one tag that run different images", () => {
    const outdated = Docker.outdated(
      [running("alpha", "nginx:alpine", "nginx@sha256:remote"), running("beta", "nginx:alpine", "nginx@sha256:old")],
      { "nginx:alpine": "sha256:remote" },
    );

    expect([...outdated]).toEqual(["beta"]);
  });

  it("makes no claim without both sides: no registry answer, or an image built here", () => {
    const outdated = Docker.outdated(
      [running("alpha", "nginx:alpine", "nginx@sha256:local"), running("beta", "local:dev")],
      { "local:dev": "sha256:remote" },
    );

    expect([...outdated]).toEqual([]);
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

    expect(await client().overview.read()).toEqual({
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

    const overview = await client().overview.read();

    expect(overview.images).toEqual({ total: 0, unused: 0, size: 0 });
    expect(overview.volumes).toEqual({ total: 0, inUse: 0, unused: 0 });
  });
});

describe("Docker.loadContainers", () => {
  it("serves one daemon load to concurrent callers and to the next render", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await Promise.all([docker.projects.read(), docker.projects.read()]);
    await docker.projects.read();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
  });

  it("serves the same load to the apps list and to one project's detail", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await docker.projects.read();
    await docker.projectDetail("alpha");

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
  });

  it("keeps the containers it could inspect when one has gone away mid-load", async () => {
    const sources = [container(), container({ Id: "container-2", name: "/alpha-web-2" })];

    givenContainers(sources);

    // A container that exits between the list and its inspect answers 404, which is the common
    // case right after a `compose down` — not a reason to fail the whole page.
    dockerMock.inspect.mockImplementation((id: string) =>
      id === "container-2"
        ? Promise.reject(Object.assign(new Error("no such container"), { statusCode: 404 }))
        : Promise.resolve(sources.find(entry => entry.info.Id === id)?.detail),
    );

    const { projects } = await client("alpha").projects.read();

    expect(projects[0]).toMatchObject({ name: "alpha", containerCount: 1 });
  });

  it("asks again once the loaded containers have expired", async () => {
    givenContainers([container()]);
    const docker = new Docker(fakeDockerode(), fakeApps("alpha"), 0);

    await docker.projects.read();
    await docker.projects.read();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });

  it("serves the new containers once a refresh it awaited settles", async () => {
    givenContainers([container({ state: "running" })]);
    const docker = client("alpha");

    await docker.projects.read();
    givenContainers([container({ state: "exited" })]);
    await docker.refresh(["containers"]);

    // From memory, without waiting on the daemon: that is what lets the page reload paint at once.
    expect(docker.projects.peek()?.data.projects[0]).toMatchObject({ name: "alpha", status: "stopped" });
    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });

  it("refreshes only what went stale", async () => {
    givenContainers([container()]);
    dockerMock.listImages.mockResolvedValue([]);
    const docker = client("alpha");

    await docker.runningImages.read();
    await docker.refresh(["images"]);

    expect(dockerMock.listImages).toHaveBeenCalledTimes(2);
    expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    const docker = client("alpha");

    dockerMock.listContainers.mockRejectedValueOnce(new Error("socket gone"));

    await expect(docker.projects.read()).rejects.toThrow("socket gone");
    givenContainers([container()]);

    await expect(docker.projects.read()).resolves.toMatchObject({ projects: [{ name: "alpha" }] });
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

    expect((await docker.overview.read()).version).toBe("27.3.1");

    givenDaemon("28.0.0");
    vi.setSystemTime(START + 310_000);

    // Past its TTL but inside the grace window: the caller gets the snapshot without waiting on
    // the daemon, and the reload goes out behind it.
    expect((await docker.overview.read()).version).toBe("27.3.1");
    expect(dockerMock.df).toHaveBeenCalledTimes(2);

    // Once that reload settles, the snapshot is the new one.
    await vi.waitFor(async () => expect((await docker.overview.read()).version).toBe("28.0.0"));
  });

  it("stops serving a stale overview once the daemon has been down past the grace window", async () => {
    const docker = client("alpha");

    givenDaemon("27.3.1");
    await docker.overview.read();

    dockerMock.info.mockRejectedValue(new Error("socket gone"));
    dockerMock.df.mockRejectedValue(new Error("socket gone"));

    // Inside the grace window the failed reload puts the snapshot back, timestamp and all...
    vi.setSystemTime(START + 310_000);
    await expect(docker.overview.read()).resolves.toMatchObject({ version: "27.3.1" });

    // ...so it keeps ageing, and past it the caller gets the daemon's real error instead.
    vi.setSystemTime(START + 4_000_000);
    await expect(docker.overview.read()).rejects.toThrow("socket gone");
  });

  it("serves stale containers at once rather than waiting on the daemon", async () => {
    givenContainers([container()]);
    const docker = client("alpha");

    await docker.projects.read();
    vi.setSystemTime(START + 61_000);
    await docker.projects.read();

    expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
  });
});
