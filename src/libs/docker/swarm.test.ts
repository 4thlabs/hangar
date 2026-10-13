import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dockerMock, fakeDockerode, givenSwarm, swarmNode, swarmService, swarmTask } = await import("./mock/index.ts");
const { Cache } = await import("#libs/cache");
const { DockerSwarm } = await import("./swarm.ts");
const { SwarmDaemonError, SwarmRefusedError } = await import("./swarm-errors.ts");
const { DockerNotFoundError } = await import("./compose.ts");

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
        labels: { zone: "home" },
        engineLabels: {},
        tasks: 0,
        actions: ["drain"],
      },
    ]);
  });

  it("only asks for the tasks meant to run, and for the services' task counts", async () => {
    givenSwarm({ nodes: [swarmNode()] });

    await client().cluster();

    expect(dockerMock.listTasks).toHaveBeenCalledWith({ filters: { "desired-state": ["running"] } });
    expect(dockerMock.listServices).toHaveBeenCalledWith({ status: true });
  });

  it("tells the node labels Hangar can change from the ones the host's daemon.json sets", async () => {
    givenSwarm({ nodes: [swarmNode({ labels: { disk: "ssd" }, engineLabels: { gpu: "nvidia" } })] });

    const cluster = await client().cluster();

    expect(cluster.state === "manager" && cluster.nodes[0]).toMatchObject({
      labels: { disk: "ssd" },
      engineLabels: { gpu: "nvidia" },
    });
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

describe("DockerSwarm stacks", () => {
  /** Two nodes, `nas` first as the current one. */
  const twoNodes = [
    swarmNode({ id: "nas", hostname: "nas", leader: true }),
    swarmNode({ id: "pi", hostname: "pi-01" }),
  ];

  const manager = async () => {
    const cluster = await client().cluster();

    if (cluster.state !== "manager") {
      throw new Error(`expected a manager, got ${cluster.state}`);
    }

    return cluster;
  };

  it("lists a stack once, with its replicas and the nodes its tasks run on, in node order", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: [swarmNode({ id: "pi", hostname: "pi-01" }), swarmNode({ id: "nas", hostname: "nas", leader: true })],
      services: [swarmService({ id: "web", stack: "miniflux", running: 3, desired: 3 })],
      tasks: [
        swarmTask({ service: "web", node: "pi" }),
        swarmTask({ service: "web", node: "nas" }),
        swarmTask({ service: "web", node: "nas" }),
      ],
    });

    const { stacks, nodes } = await manager();

    expect(stacks).toEqual([
      {
        name: "miniflux",
        health: "running",
        running: 3,
        desired: 3,
        placement: [
          { nodeId: "nas", hostname: "nas", tasks: 2 },
          { nodeId: "pi", hostname: "pi-01", tasks: 1 },
        ],
      },
    ]);

    expect(nodes.map(node => [node.hostname, node.tasks])).toEqual([
      ["nas", 2],
      ["pi-01", 1],
    ]);
  });

  it("groups the services of a stack into one, and names a lone service after itself", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [
        swarmService({ id: "web", name: "miniflux_miniflux", stack: "miniflux", running: 1, desired: 1 }),
        swarmService({ id: "db", name: "miniflux_db", stack: "miniflux", running: 1, desired: 1 }),
        swarmService({ id: "lone", name: "whoami" }),
      ],
      tasks: [swarmTask({ service: "web" }), swarmTask({ service: "db" }), swarmTask({ service: "lone" })].map(
        task => ({ ...task, NodeID: "nas" }),
      ),
    });

    const { stacks } = await manager();

    expect(stacks.map(stack => [stack.name, stack.running, stack.desired, stack.placement[0]?.tasks])).toEqual([
      ["miniflux", 2, 2, 2],
      ["whoami", 1, 1, 1],
    ]);
  });

  it("rates a stack across the whole cluster, from the daemon's counts, a global service included", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [
        swarmService({ id: "web", stack: "miniflux", running: 2, desired: 2 }),
        swarmService({ id: "db", stack: "miniflux", running: 0, desired: 1 }),
        swarmService({ id: "agent", name: "monitoring_agent", stack: "monitoring", running: 1, desired: 2 }),
      ],
      tasks: [swarmTask({ service: "web", node: "nas" }), swarmTask({ service: "agent", node: "nas" })],
    });

    const { stacks } = await manager();

    expect(stacks.map(stack => [stack.name, stack.health])).toEqual([
      ["miniflux", "partial"],
      ["monitoring", "partial"],
    ]);
  });

  it("keeps a stack with no task running anywhere, with an empty placement", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [
        swarmService({ id: "crash", stack: "broken", running: 0, desired: 2 }),
        swarmService({ id: "zero", name: "scaled-down", running: 0, desired: 0 }),
      ],
      tasks: [swarmTask({ service: "crash", node: "nas", state: "failed" })],
    });

    const { stacks, nodes } = await manager();

    expect(stacks).toEqual([
      { name: "broken", health: "stopped", running: 0, desired: 2, placement: [] },
      { name: "scaled-down", health: "stopped", running: 0, desired: 0, placement: [] },
    ]);

    expect(nodes.every(node => node.tasks === 0)).toBe(true);
  });

  it("counts no task whose service is already gone", async () => {
    givenSwarm({
      nodeId: "nas",
      nodes: twoNodes,
      services: [],
      tasks: [swarmTask({ service: "removed", node: "nas" })],
    });

    const { stacks, nodes } = await manager();

    expect(stacks).toEqual([]);
    expect(nodes[0]?.tasks).toBe(0);
  });
});

describe("DockerSwarm managers", () => {
  it("counts the managers of the cluster", async () => {
    givenSwarm({
      nodes: [
        swarmNode({ id: "a", leader: true }),
        swarmNode({ id: "b" }),
        swarmNode({ id: "c" }),
        swarmNode({ id: "d", role: "worker" }),
      ],
    });

    await expect(client().cluster()).resolves.toMatchObject({ managers: 3 });
  });
});

describe("DockerSwarm.changeNode", () => {
  const cluster = () => [
    swarmNode({ id: "nas", hostname: "nas", leader: true }),
    swarmNode({ id: "pi", hostname: "pi-01", role: "worker" }),
    swarmNode({ id: "old", hostname: "old", role: "worker", state: "down" }),
  ];

  it("merges the change over the node's whole spec, at its version", async () => {
    givenSwarm({ nodes: cluster() });

    await client().changeNode("pi", "promote");

    expect(dockerMock.updateNode).toHaveBeenCalledWith("pi", {
      _query: { version: 42 },
      _body: { Role: "manager", Availability: "active", Labels: { zone: "home" } },
    });
  });

  it("drains and reactivates through the availability", async () => {
    givenSwarm({ nodes: cluster() });

    await client().changeNode("nas", "drain");

    expect(dockerMock.updateNode).toHaveBeenCalledWith(
      "nas",
      expect.objectContaining({ _body: expect.objectContaining({ Availability: "drain" }) }),
    );
  });

  it("removes a worker that is down", async () => {
    givenSwarm({ nodes: cluster() });

    await client().changeNode("old", "remove");

    expect(dockerMock.removeNode).toHaveBeenCalledWith("old", {});
    expect(dockerMock.updateNode).not.toHaveBeenCalled();
  });

  it("refuses to demote the last manager, without calling the daemon", async () => {
    givenSwarm({ nodes: cluster() });

    const demotion = client().changeNode("nas", "demote");

    await expect(demotion).rejects.toBeInstanceOf(SwarmRefusedError);
    await expect(demotion).rejects.toMatchObject({ refusal: "last-manager" });
    expect(dockerMock.updateNode).not.toHaveBeenCalled();
  });

  it("refuses to remove a node that is still up, or one it does not know", async () => {
    givenSwarm({ nodes: cluster() });

    await expect(client().changeNode("pi", "remove")).rejects.toMatchObject({ refusal: "node-not-down" });
    await expect(client().changeNode("ghost", "drain")).rejects.toMatchObject({ refusal: "unknown-node" });
    expect(dockerMock.removeNode).not.toHaveBeenCalled();
  });

  it("lists, for each node, the actions that apply to it", async () => {
    givenSwarm({ nodeId: "nas", nodes: cluster() });

    const state = await client().cluster();

    expect(state.state === "manager" && state.nodes.map(node => [node.hostname, node.actions])).toEqual([
      ["nas", ["drain"]],
      ["old", ["promote", "drain", "remove"]],
      ["pi-01", ["promote", "drain"]],
    ]);
  });
});

describe("DockerSwarm.changeNodeLabels", () => {
  const labelled = () => [swarmNode({ id: "nas", leader: true, labels: { zone: "home", disk: "hdd", old: "" } })];

  it("adds, changes and drops labels over the daemon's current ones, at the node's version", async () => {
    givenSwarm({ nodes: labelled() });

    await client().changeNodeLabels("nas", { set: { disk: "ssd", gpu: "" }, remove: ["old"] });

    expect(dockerMock.updateNode).toHaveBeenCalledWith("nas", {
      _query: { version: 42 },
      _body: { Role: "manager", Availability: "active", Labels: { zone: "home", disk: "ssd", gpu: "" } },
    });
  });

  it("keeps a key both removed and set, with its new value", async () => {
    givenSwarm({ nodes: labelled() });

    await client().changeNodeLabels("nas", { set: { disk: "nvme" }, remove: ["disk"] });

    expect(dockerMock.updateNode).toHaveBeenCalledWith(
      "nas",
      expect.objectContaining({ _body: expect.objectContaining({ Labels: { zone: "home", disk: "nvme", old: "" } }) }),
    );
  });

  it("refuses a node no longer in the cluster, without calling the daemon", async () => {
    givenSwarm({ nodes: labelled() });

    await expect(client().changeNodeLabels("ghost", { set: { disk: "ssd" }, remove: [] })).rejects.toMatchObject({
      refusal: "unknown-node",
    });

    expect(dockerMock.updateNode).not.toHaveBeenCalled();
  });

  it("passes on the daemon's refusal when the node changed since it was read", async () => {
    givenSwarm({ nodes: labelled() });
    dockerMock.updateNode.mockRejectedValueOnce(
      Object.assign(new Error("(HTTP code 500) server error"), {
        statusCode: 500,
        json: { message: "update out of sequence" },
      }),
    );

    await expect(client().changeNodeLabels("nas", { set: { disk: "ssd" }, remove: [] })).rejects.toEqual(
      new SwarmDaemonError(500, "update out of sequence"),
    );
  });
});

describe("DockerSwarm membership", () => {
  it("creates a swarm listening on the default port, with the address given", async () => {
    givenSwarm({ localState: "inactive", manager: false });

    await client().init("192.168.1.10");

    expect(dockerMock.swarmInit).toHaveBeenCalledWith({ ListenAddr: "0.0.0.0:2377", AdvertiseAddr: "192.168.1.10" });
  });

  it("joins through the given manager, with the token", async () => {
    givenSwarm({ localState: "inactive", manager: false });

    await client().join({ managerAddress: "192.168.1.10:2377", token: "SWMTKN-1-worker" });

    expect(dockerMock.swarmJoin).toHaveBeenCalledWith({
      ListenAddr: "0.0.0.0:2377",
      AdvertiseAddr: undefined,
      RemoteAddrs: ["192.168.1.10:2377"],
      JoinToken: "SWMTKN-1-worker",
    });
  });

  it("gives the join commands pointing at this manager", async () => {
    givenSwarm();

    await expect(client().joinCommands()).resolves.toEqual({
      worker: "docker swarm join --token SWMTKN-1-worker 192.168.1.10:2377",
      manager: "docker swarm join --token SWMTKN-1-manager 192.168.1.10:2377",
    });
  });

  it("rotates one token, sending the spec back unchanged at its version", async () => {
    givenSwarm();

    await client().rotateToken("manager");

    expect(dockerMock.swarmUpdate).toHaveBeenCalledWith({
      _query: { version: 7, rotateWorkerToken: false, rotateManagerToken: true },
      _body: { Name: "default", Orchestration: {} },
    });
  });
});

describe("DockerSwarm.stackTasks", () => {
  it("lists every task of a stack, current and past, by name then newest first, with hostnames", async () => {
    givenSwarm({
      nodes: [swarmNode({ id: "nas", hostname: "nas" }), swarmNode({ id: "pi", hostname: "pi-01", role: "worker" })],
      services: [
        swarmService({ id: "web", name: "miniflux_web", stack: "miniflux" }),
        swarmService({ id: "other", name: "whoami" }),
      ],
      tasks: [
        swarmTask({
          id: "old",
          service: "web",
          node: "pi",
          state: "failed",
          since: "2026-10-11T09:00:00Z",
          error: "task: non-zero exit (1)",
        }),
        swarmTask({ id: "new", service: "web", node: "nas", since: "2026-10-11T10:00:00Z" }),
      ],
    });

    const tasks = await client().stackTasks("miniflux");

    expect(dockerMock.listTasks).toHaveBeenCalledWith({ filters: { service: ["web"] } });
    expect(tasks).toEqual([
      {
        id: "new",
        name: "miniflux_web.1",
        service: "miniflux_web",
        node: "nas",
        desiredState: "running",
        state: "running",
        since: "2026-10-11T10:00:00Z",
        error: "",
      },
      {
        id: "old",
        name: "miniflux_web.1",
        service: "miniflux_web",
        node: "pi-01",
        desiredState: "shutdown",
        state: "failed",
        since: "2026-10-11T09:00:00Z",
        error: "task: non-zero exit (1)",
      },
    ]);
  });

  it("finds a lone service by its name, and nothing for an unknown stack", async () => {
    givenSwarm({ nodes: [swarmNode()], services: [swarmService({ id: "lone", name: "whoami" })] });

    await expect(client().stackTasks("nope")).resolves.toEqual([]);
    await client().stackTasks("whoami");

    expect(dockerMock.listTasks).toHaveBeenCalledWith({ filters: { service: ["lone"] } });
  });
});

describe("DockerSwarm.openServiceLogs", () => {
  const signal = new AbortController().signal;

  /** A stack with one service, `miniflux_web`, its two replicas on two nodes. */
  const givenStack = (tty = false) =>
    givenSwarm({
      nodes: [swarmNode({ id: "nas", hostname: "nas" }), swarmNode({ id: "pi", hostname: "pi-01", role: "worker" })],
      services: [
        swarmService({ id: "web", name: "miniflux_web", stack: "miniflux", tty }),
        swarmService({ id: "other", name: "whoami_web", stack: "whoami" }),
      ],
      tasks: [
        swarmTask({ id: "t1", service: "web", node: "nas" }),
        swarmTask({ id: "t2", service: "web", node: "pi", slot: 2 }),
      ],
    });

  /** A line as the daemon sends it with `details` and `timestamps`. */
  const daemonLine = (task: string, message: string) =>
    `2026-10-11T10:00:00.000Z com.docker.swarm.node.id=nas,com.docker.swarm.service.id=web,com.docker.swarm.task.id=${task} ${message}\n`;

  /** Everything the stream gives until it ends. */
  const readAll = async (stream: NodeJS.ReadableStream) => {
    let text = "";

    for await (const chunk of stream) {
      text += chunk.toString();
    }

    return text;
  };

  beforeEach(() => {
    dockerMock.serviceLogs.mockImplementation(() => Promise.resolve(new PassThrough()));
    // Demuxing is the daemon's framing, not this module's logic: pass the bytes straight through.
    dockerMock.demuxStream.mockImplementation((source: PassThrough, out: PassThrough) => source.pipe(out));
  });

  it("refuses a service of another stack, or one the stack does not have, without reading logs", async () => {
    givenStack();

    await expect(client().openServiceLogs("miniflux", "whoami_web", signal)).rejects.toBeInstanceOf(
      DockerNotFoundError,
    );

    await expect(client().openServiceLogs("miniflux", "miniflux_db", signal)).rejects.toBeInstanceOf(
      DockerNotFoundError,
    );

    expect(dockerMock.serviceLogs).not.toHaveBeenCalled();
  });

  it("follows the service from the tail, each line naming its task and node", async () => {
    givenStack();
    const source = new PassThrough();

    dockerMock.serviceLogs.mockResolvedValue(source);

    const stream = await client().openServiceLogs("miniflux", "miniflux_web", signal);

    source.end(daemonLine("t1", "ready") + daemonLine("t2", "listening on :8080"));

    await expect(readAll(stream)).resolves.toBe(
      "2026-10-11T10:00:00.000Z miniflux_web.1@nas | ready\n" +
        "2026-10-11T10:00:00.000Z miniflux_web.2@pi-01 | listening on :8080\n",
    );

    expect(dockerMock.serviceLogs).toHaveBeenCalledWith(
      "web",
      expect.objectContaining({ follow: true, stdout: true, stderr: true, tail: 200, timestamps: true, details: true }),
    );
  });

  it("demuxes a service without a TTY and pipes a TTY one straight through", async () => {
    givenStack();
    await client().openServiceLogs("miniflux", "miniflux_web", signal);
    expect(dockerMock.demuxStream).toHaveBeenCalled();

    vi.clearAllMocks();
    givenStack(true);

    await client().openServiceLogs("miniflux", "miniflux_web", signal);
    expect(dockerMock.demuxStream).not.toHaveBeenCalled();
  });

  it("tears the log stream down when the request is aborted", async () => {
    givenStack();
    const source = new PassThrough();
    const controller = new AbortController();

    dockerMock.serviceLogs.mockResolvedValue(source);

    await client().openServiceLogs("miniflux", "miniflux_web", controller.signal);
    controller.abort();

    expect(source.destroyed).toBe(true);
  });

  it("tears the log stream down when the request was aborted while it opened", async () => {
    givenStack();
    const source = new PassThrough();
    const controller = new AbortController();

    dockerMock.serviceLogs.mockImplementation(async () => {
      controller.abort();

      return source;
    });

    await client().openServiceLogs("miniflux", "miniflux_web", controller.signal);

    expect(source.destroyed).toBe(true);
  });
});

describe("DockerSwarm daemon refusals", () => {
  it("passes on the daemon's own message as a SwarmDaemonError", async () => {
    givenSwarm({ manager: false });

    const read = client().stackTasks("miniflux");

    await expect(read).rejects.toBeInstanceOf(SwarmDaemonError);
    await expect(read).rejects.toMatchObject({ statusCode: 503, message: "This node is not a swarm manager." });
  });

  it("leaves an error without a daemon message as it is", async () => {
    givenSwarm({ localState: "inactive", manager: false });
    dockerMock.swarmInit.mockRejectedValueOnce(new Error("connect ENOENT /var/run/docker.sock"));

    await expect(client().init()).rejects.toThrow("connect ENOENT");
  });
});
