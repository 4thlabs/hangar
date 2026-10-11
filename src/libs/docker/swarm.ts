import type Dockerode from "dockerode";
import type { Cache, CachePolicy } from "#libs/cache";

/** What this node's daemon says of its own place in a swarm, outside a working membership. */
export type SwarmLocalState = "inactive" | "pending" | "locked" | "error";

/** A node's part in the cluster; the leader is the one manager the others follow. */
export type SwarmNodeRole = "leader" | "manager" | "worker";

/** Whether the managers hear from the node, as `GET /nodes` reports it. */
export type SwarmNodeStatus = "ready" | "down" | "unknown" | "disconnected";

/** Whether the scheduler may place tasks on the node. */
export type SwarmNodeAvailability = "active" | "pause" | "drain";

/** How much of a stack runs across the cluster: every desired task, some of them, or none. */
export type SwarmStackHealth = "running" | "partial" | "stopped";

/** One stack, or one service outside a stack, as seen from a node that runs some of its tasks. */
export type SwarmStackOnNode = {
  name: string;
  /** Across the whole cluster, not only this node. */
  health: SwarmStackHealth;
  /** The stack's tasks running on this node. */
  tasks: number;
};

/** One member of the cluster, with the stacks it runs. */
export type SwarmNode = {
  id: string;
  hostname: string;
  role: SwarmNodeRole;
  status: SwarmNodeStatus;
  availability: SwarmNodeAvailability;
  cpus: number;
  memoryBytes: number;
  engineVersion: string;
  stacks: SwarmStackOnNode[];
};

/**
 * The swarm as this node's daemon sees it. Only a manager answers for the whole cluster; a worker
 * knows the managers' addresses, and nothing of the cluster itself, not even its id.
 */
export type SwarmCluster =
  | { state: SwarmLocalState; error: string }
  | { state: "worker"; managers: string[] }
  | {
      state: "manager";
      clusterId: string;
      currentNodeId: string;
      managers: number;
      /** How many managers can fail before the cluster loses its quorum. */
      faultTolerance: number;
      /** This node first, then the other managers, then by hostname. */
      nodes: SwarmNode[];
    };

/** The `info.Swarm` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type SwarmInfo = {
  Swarm?: {
    LocalNodeState?: string;
    ControlAvailable?: boolean;
    NodeID?: string;
    Error?: string;
    RemoteManagers?: { Addr: string }[] | null;
    Cluster?: { ID: string };
  };
};

/** The `GET /nodes` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type NodeInfo = {
  ID: string;
  Spec?: { Role?: string; Availability?: SwarmNodeAvailability };
  Description?: {
    Hostname?: string;
    Resources?: { NanoCPUs?: number; MemoryBytes?: number };
    Engine?: { EngineVersion?: string };
  };
  Status?: { State?: SwarmNodeStatus };
  ManagerStatus?: { Leader?: boolean };
};

/** The `GET /tasks` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type TaskInfo = {
  ServiceID: string;
  NodeID?: string;
  Status?: { State?: string };
};

/**
 * The swarm this Hangar's daemon belongs to, read through the Engine API: nodes, and the stacks each
 * one runs. Read-only; compose containers are never part of it.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class DockerSwarm {
  /**
   * Under `docker:swarm`, the prefix the daemon's `node` and `service` events refresh (see
   * `DockerEvents`).
   */
  private static readonly Key = "docker:swarm:cluster";

  /** Short, because Docker emits no event for a task: only the TTL moves the task counts. */
  private static readonly Ttl = 10_000;

  /** How long past its TTL the cluster is still served while it reloads. */
  private static readonly MaxStale = 60_000;

  /** The label `docker stack deploy` puts on every service of a stack. */
  private static readonly StackLabel = "com.docker.stack.namespace";

  private readonly docker: Dockerode;

  /** Where the daemon's answers are kept, under `docker:swarm:` keys. */
  private readonly cache: Cache;

  private readonly policy: CachePolicy;

  /**
   * @param docker An Engine API client; injected so the composition root owns the connection
   * @param cache Where the daemon's answers are kept; one per process
   * @param ttl How long the loaded cluster is reused; injected so a test can drive it
   */
  constructor(docker: Dockerode, cache: Cache, ttl = DockerSwarm.Ttl) {
    this.docker = docker;
    this.cache = cache;
    this.policy = { ttl, maxStale: DockerSwarm.MaxStale };
  }

  /** The swarm as this node sees it; see {@link SwarmCluster}. */
  cluster(): Promise<SwarmCluster> {
    return this.cache.get(DockerSwarm.Key, this.policy, this.loadCluster);
  }

  /**
   * How many managers can fail before the rest no longer form a majority.
   * @param managers How many managers the cluster has
   */
  static faultTolerance(managers: number) {
    return Math.max(0, Math.floor((managers - 1) / 2));
  }

  /**
   * The load behind {@link cluster}. `info` first: the cluster-wide calls answer `503` on a worker,
   * so they are only made on a manager.
   */
  private readonly loadCluster = async (): Promise<SwarmCluster> => {
    const { Swarm: swarm = {} } = (await this.docker.info()) as SwarmInfo;
    const localState = swarm.LocalNodeState || "inactive";

    if (localState !== "active") {
      return { state: localState as SwarmLocalState, error: swarm.Error ?? "" };
    }

    if (!swarm.ControlAvailable) {
      return { state: "worker", managers: (swarm.RemoteManagers ?? []).map(manager => manager.Addr) };
    }

    const [nodes, services, tasks] = await Promise.all([
      this.docker.listNodes() as Promise<NodeInfo[]>,
      this.docker.listServices({ status: true }),
      this.docker.listTasks({ filters: { "desired-state": ["running"] } }) as Promise<TaskInfo[]>,
    ]);

    const currentNodeId = swarm.NodeID ?? "";
    const managers = nodes.filter(node => node.Spec?.Role === "manager").length;

    return {
      state: "manager",
      clusterId: swarm.Cluster?.ID ?? "",
      currentNodeId,
      managers,
      faultTolerance: DockerSwarm.faultTolerance(managers),
      nodes: DockerSwarm.sortNodes(DockerSwarm.nodes(nodes, services, tasks), currentNodeId),
    };
  };

  /**
   * Every node with the stacks it runs. A stack spread over several nodes shows on each of them; its
   * health is the same everywhere, since it counts the whole cluster.
   */
  private static nodes(nodes: NodeInfo[], services: Dockerode.Service[], tasks: TaskInfo[]): SwarmNode[] {
    const stackByService = new Map(services.map(service => [service.ID, DockerSwarm.stackName(service)]));
    const health = DockerSwarm.stackHealth(services);

    return nodes.map(node => {
      const runningHere = tasks.filter(task => task.NodeID === node.ID && task.Status?.State === "running");
      const tasksPerStack = new Map<string, number>();

      for (const task of runningHere) {
        const stack = stackByService.get(task.ServiceID);

        // A task whose service was removed since the list: it is on its way out.
        if (stack !== undefined) {
          tasksPerStack.set(stack, (tasksPerStack.get(stack) ?? 0) + 1);
        }
      }

      const stacks = [...tasksPerStack]
        .map(([name, count]) => ({ name, health: health.get(name) ?? "stopped", tasks: count }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return DockerSwarm.node(node, stacks);
    });
  }

  /** One node's own fields, from `GET /nodes`. */
  private static node(node: NodeInfo, stacks: SwarmStackOnNode[]): SwarmNode {
    const resources = node.Description?.Resources;

    return {
      id: node.ID,
      hostname: node.Description?.Hostname ?? node.ID,
      role: DockerSwarm.role(node),
      status: node.Status?.State ?? "unknown",
      availability: node.Spec?.Availability ?? "active",
      cpus: (resources?.NanoCPUs ?? 0) / 1e9,
      memoryBytes: resources?.MemoryBytes ?? 0,
      engineVersion: node.Description?.Engine?.EngineVersion ?? "",
      stacks,
    };
  }

  private static role(node: NodeInfo): SwarmNodeRole {
    if (node.ManagerStatus?.Leader) {
      return "leader";
    }

    if (node.Spec?.Role === "manager") {
      return "manager";
    }

    return "worker";
  }

  /** The stack a service belongs to, or the service itself outside a stack. */
  private static stackName(service: Dockerode.Service) {
    return service.Spec?.Labels?.[DockerSwarm.StackLabel] ?? service.Spec?.Name ?? service.ID;
  }

  /**
   * Each stack's health, from the counts the daemon keeps per service: they cover a `global` service
   * too, whose desired count follows the eligible nodes.
   */
  private static stackHealth(services: Dockerode.Service[]): Map<string, SwarmStackHealth> {
    const counts = new Map<string, { running: number; desired: number }>();

    for (const service of services) {
      const stack = DockerSwarm.stackName(service);
      const count = counts.get(stack) ?? { running: 0, desired: 0 };

      count.running += service.ServiceStatus?.RunningTasks ?? 0;
      count.desired += service.ServiceStatus?.DesiredTasks ?? 0;
      counts.set(stack, count);
    }

    return new Map([...counts].map(([stack, count]) => [stack, DockerSwarm.health(count.running, count.desired)]));
  }

  private static health(running: number, desired: number): SwarmStackHealth {
    if (running === 0) {
      return "stopped";
    }

    if (running >= desired) {
      return "running";
    }

    return "partial";
  }

  /** This node first, then the other managers, then by hostname. */
  private static sortNodes(nodes: SwarmNode[], currentNodeId: string): SwarmNode[] {
    const rank = (node: SwarmNode) => {
      if (node.id === currentNodeId) {
        return 0;
      }

      if (node.role === "worker") {
        return 2;
      }

      return 1;
    };

    return [...nodes].sort((a, b) => rank(a) - rank(b) || a.hostname.localeCompare(b.hostname));
  }
}
