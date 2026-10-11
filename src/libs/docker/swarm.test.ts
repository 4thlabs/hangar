import { beforeEach, describe, expect, it, vi } from "vitest";

const { dockerMock, fakeDockerode, givenSwarm, swarmNode, swarmService, swarmTask } = await import("./mock/index.ts");
const { Cache } = await import("#libs/cache");
const { DockerSwarm } = await import("./swarm.ts");

const client = () => new DockerSwarm(fakeDockerode(), new Cache());

beforeEach(() => vi.clearAllMocks());

describe("DockerSwarm.cluster", () => {
  it("says so when this node is in no swarm, without asking for the cluster", async () => {
    givenSwarm({ localState: "inactive", manager: false });

    await expect(client().cluster()).resolves.toEqual({ state: "inactive", error: "" });
    expect(dockerMock.listNodes).not.toHaveBeenCalled();
  });

  it("reports a manager locked by autolock", async () => {
    givenSwarm({ localState: "locked", manager: false });

    await expect(client().cluster()).resolves.toMatchObject({ state: "locked" });
  });

  it("passes on the daemon's error when joining failed", async () => {
    givenSwarm({ localState: "error", manager: false, error: "manager unreachable" });

    await expect(client().cluster()).resolves.toEqual({ state: "error", error: "manager unreachable" });
  });

  it("gives a worker the managers' addresses, and never makes the calls it would be refused", async () => {
    givenSwarm({ manager: false, nodeId: "node-3" });

    await expect(client().cluster()).resolves.toEqual({ state: "worker", managers: ["192.168.1.10:2377"] });
    expect(dockerMock.listNodes).not.toHaveBeenCalled();
    expect(dockerMock.listServices).not.toHaveBeenCalled();
    expect(dockerMock.listTasks).not.toHaveBeenCalled();
  });

  it("describes every node of the cluster on a manager", async () => {
    givenSwarm({ nodes: [swarmNode({ leader: true })] });

    const cluster = await client().cluster();

    expect(cluster).toMatchObject({
      state: "manager",
      clusterId: "nhyx6n1b8b0a0zqlwjr4bx7xd",
      currentNodeId: "node-1",
    });

    expect(cluster.state === "manager" && cluster.nodes).toEqual([
      {
        id: "node-1",
        hostname: "nas",
        role: "leader",
        status: "ready",
        availability: "active",
        cpus: 4,
        memoryBytes: 8 * 1024 ** 3,
        engineVersion: "29.1.3",
        stacks: [],
      },
    ]);
  });

  it("only asks for the tasks meant to run, and for the services' task counts", async () => {
    givenSwarm({ nodes: [swarmNode()] });

    await client().cluster();

    expect(dockerMock.listTasks).toHaveBeenCalledWith({ filters: { "desired-state": ["running"] } });
    expect(dockerMock.listServices).toHaveBeenCalledWith({ status: true });
  });

  it("puts this node first, then the managers, then the workers by hostname", async () => {
    givenSwarm({
      nodeId: "node-pi01",
      nodes: [
        swarmNode({ id: "node-zed", hostname: "zed", role: "worker" }),
        swarmNode({ id: "node-nas", hostname: "nas", leader: true }),
        swarmNode({ id: "node-alpha", hostname: "alpha", role: "worker" }),
        swarmNode({ id: "node-pi01", hostname: "pi-01" }),
      ],
    });

    const cluster = await client().cluster();

    expect(cluster.state === "manager" && cluster.nodes.map(node => node.hostname)).toEqual([
      "pi-01",
      "nas",
      "alpha",
      "zed",
    ]);
  });
});

describe("DockerSwarm stacks per node", () => {
  /** Two nodes, `nas` running two `miniflux` replicas and `pi-01` one. */
  const twoNodes = [
    swarmNode({ id: "nas", hostname: "nas", leader: true }),
    swarmNode({ id: "pi", hostname: "pi-01" }),
  ];

  const stacksOf = async (hostname: string) => {
    const cluster = await client().cluster();

    if (cluster.state !== "manager") {
      throw new Error(`expected a manager, got ${cluster.state}`);
    }

    return cluster.nodes.find(node => node.hostname === hostname)?.stacks;
  };

  it("shows a stack spread over several nodes on each of them, with the tasks running there", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [swarmService({ id: "web", stack: "miniflux", running: 3, desired: 3 })],
      tasks: [
        swarmTask({ service: "web", node: "nas" }),
        swarmTask({ service: "web", node: "nas" }),
        swarmTask({ service: "web", node: "pi" }),
      ],
    });

    expect(await stacksOf("nas")).toEqual([{ name: "miniflux", health: "running", tasks: 2 }]);
    expect(await stacksOf("pi-01")).toEqual([{ name: "miniflux", health: "running", tasks: 1 }]);
  });

  it("groups the services of a stack into one line, and names a lone service after itself", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [
        swarmService({ id: "web", name: "miniflux_miniflux", stack: "miniflux" }),
        swarmService({ id: "db", name: "miniflux_db", stack: "miniflux" }),
        swarmService({ id: "lone", name: "whoami" }),
      ],
      tasks: [swarmTask({ service: "web" }), swarmTask({ service: "db" }), swarmTask({ service: "lone" })].map(
        task => ({
          ...task,
          NodeID: "nas",
        }),
      ),
    });

    expect(await stacksOf("nas")).toEqual([
      { name: "miniflux", health: "running", tasks: 2 },
      { name: "whoami", health: "running", tasks: 1 },
    ]);
  });

  it("rates a stack across the whole cluster, from the daemon's counts", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [
        swarmService({ id: "web", stack: "miniflux", running: 2, desired: 2 }),
        swarmService({ id: "db", stack: "miniflux", running: 0, desired: 1 }),
      ],
      tasks: [swarmTask({ service: "web", node: "nas" })],
    });

    expect(await stacksOf("nas")).toEqual([{ name: "miniflux", health: "partial", tasks: 1 }]);
  });

  it("only counts the tasks that run, and a node with none lists no stack", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [swarmService({ id: "web", stack: "miniflux", running: 1, desired: 2 })],
      tasks: [
        swarmTask({ service: "web", node: "nas" }),
        swarmTask({ service: "web", node: "pi", state: "preparing" }),
      ],
    });

    expect(await stacksOf("nas")).toEqual([{ name: "miniflux", health: "partial", tasks: 1 }]);
    expect(await stacksOf("pi-01")).toEqual([]);
  });

  it("covers a global service through its desired count", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [swarmService({ id: "agent", name: "monitoring_agent", stack: "monitoring", running: 1, desired: 2 })],
      tasks: [swarmTask({ service: "agent", node: "nas" })],
    });

    expect(await stacksOf("nas")).toEqual([{ name: "monitoring", health: "partial", tasks: 1 }]);
  });

  it("skips a task whose service is already gone", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [],
      tasks: [swarmTask({ service: "removed", node: "nas" })],
    });

    expect(await stacksOf("nas")).toEqual([]);
  });
});

describe("DockerSwarm.faultTolerance", () => {
  it("is how many managers can fail with a majority left", () => {
    expect([1, 2, 3, 4, 5, 7].map(managers => DockerSwarm.faultTolerance(managers))).toEqual([0, 0, 1, 1, 2, 3]);
  });

  it("counts the managers of the cluster", async () => {
    givenSwarm({
      nodes: [
        swarmNode({ id: "a", leader: true }),
        swarmNode({ id: "b" }),
        swarmNode({ id: "c" }),
        swarmNode({ id: "d", role: "worker" }),
      ],
    });

    await expect(client().cluster()).resolves.toMatchObject({ managers: 3, faultTolerance: 1 });
  });
});
