import type { SwarmManagerView, SwarmNode } from "../swarm.ts";
import { dockerMock } from "./mock.ts";

type NodeOverrides = {
  id?: string;
  hostname?: string;
  role?: "manager" | "worker";
  leader?: boolean;
  state?: string;
  availability?: string;
};

/** One node as `GET /nodes` lists it, with only the fields `DockerSwarm` reads filled in. */
export function swarmNode({
  id = "node-1",
  hostname = "nas",
  role = "manager",
  leader = false,
  state = "ready",
  availability = "active",
}: NodeOverrides = {}) {
  return {
    ID: id,
    Version: { Index: 42 },
    Spec: { Role: role, Availability: availability, Labels: { zone: "home" } },
    Description: {
      Hostname: hostname,
      Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8 * 1024 ** 3 },
      Engine: { EngineVersion: "29.1.3" },
    },
    Status: { State: state },
    ...(role === "manager" ? { ManagerStatus: { Leader: leader, Reachability: "reachable" } } : {}),
  };
}

type ServiceOverrides = {
  id?: string;
  name?: string;
  stack?: string;
  running?: number;
  desired?: number;
};

/** One service as `GET /services?status=true` lists it; `stack` sets the label `docker stack deploy` adds. */
export function swarmService({
  id = "service-1",
  name = "miniflux_miniflux",
  stack,
  running = 1,
  desired = 1,
}: ServiceOverrides = {}) {
  return {
    ID: id,
    Spec: { Name: name, Labels: stack ? { "com.docker.stack.namespace": stack } : {} },
    ServiceStatus: { RunningTasks: running, DesiredTasks: desired, CompletedTasks: 0 },
  };
}

type TaskOverrides = {
  id?: string;
  service?: string;
  node?: string;
  slot?: number;
  state?: string;
  since?: string;
  error?: string;
};

/** One task as `GET /tasks` lists it. */
export function swarmTask({
  id = "task-1",
  service = "service-1",
  node = "node-1",
  slot = 1,
  state = "running",
  since = "2026-10-11T10:00:00Z",
  error,
}: TaskOverrides = {}) {
  return {
    ID: id,
    ServiceID: service,
    NodeID: node,
    Slot: slot,
    DesiredState: state === "running" ? "running" : "shutdown",
    Status: { State: state, Timestamp: since, ...(error ? { Err: error } : {}) },
  };
}

type SwarmOverrides = {
  /** `info.Swarm.LocalNodeState`. */
  localState?: string;
  manager?: boolean;
  nodeId?: string;
  error?: string;
  nodes?: ReturnType<typeof swarmNode>[];
  services?: ReturnType<typeof swarmService>[];
  tasks?: ReturnType<typeof swarmTask>[];
};

/**
 * Wires `info` and the cluster-wide lists the way a daemon in a swarm answers them. A worker's
 * daemon answers `503` on the lists, as the real one does.
 */
export function givenSwarm({
  localState = "active",
  manager = true,
  nodeId = "node-1",
  error = "",
  nodes = [],
  services = [],
  tasks = [],
}: SwarmOverrides = {}) {
  dockerMock.info.mockResolvedValue({
    Swarm: {
      LocalNodeState: localState,
      ControlAvailable: manager,
      NodeID: nodeId,
      Error: error,
      NodeAddr: "192.168.1.10",
      RemoteManagers: [{ NodeID: "node-1", Addr: "192.168.1.10:2377" }],
      ...(manager ? { Cluster: { ID: "nhyx6n1b8b0a0zqlwjr4bx7xd" } } : {}),
    },
  });

  // The shape dockerode gives a daemon's refusal: the status, and the daemon's message as JSON.
  const workerRefusal = Object.assign(new Error("(HTTP code 503) unexpected"), {
    statusCode: 503,
    json: { message: "This node is not a swarm manager." },
  });

  const answer = <T>(value: T) => (manager ? Promise.resolve(value) : Promise.reject(workerRefusal));

  dockerMock.listNodes.mockImplementation(() => answer(nodes));
  dockerMock.listServices.mockImplementation(() => answer(services));
  dockerMock.listTasks.mockImplementation(() => answer(tasks));
  dockerMock.swarmInspect.mockImplementation(() =>
    answer({
      Version: { Index: 7 },
      Spec: { Name: "default", Orchestration: {} },
      JoinTokens: { Worker: "SWMTKN-1-worker", Manager: "SWMTKN-1-manager" },
    }),
  );
}

/** One node as `DockerSwarm.cluster` describes it, the page's input: a lone ready leader by default. */
export function swarmNodeView(overrides: Partial<SwarmNode> = {}): SwarmNode {
  return {
    id: "node-1",
    hostname: "nas",
    role: "leader",
    status: "ready",
    availability: "active",
    cpus: 8,
    memoryBytes: 32 * 1024 ** 3,
    engineVersion: "29.1.3",
    stacks: [],
    actions: [],
    ...overrides,
  };
}

/** The cluster as a manager describes it: one manager, {@link swarmNodeView}, unless told otherwise. */
export function managerView(overrides: Partial<SwarmManagerView> = {}): SwarmManagerView {
  return {
    state: "manager",
    clusterId: "nhyx6n1b8b0a0zqlwjr4bx7xd",
    currentNodeId: "node-1",
    managers: 1,
    nodes: [swarmNodeView()],
    ...overrides,
  };
}
