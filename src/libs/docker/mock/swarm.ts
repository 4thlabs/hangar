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
  service?: string;
  node?: string;
  state?: string;
};

/** One task as `GET /tasks` lists it. */
export function swarmTask({ service = "service-1", node = "node-1", state = "running" }: TaskOverrides = {}) {
  return { ServiceID: service, NodeID: node, Status: { State: state } };
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

  const workerRefusal = Object.assign(new Error("This node is not a swarm manager."), { statusCode: 503 });
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
