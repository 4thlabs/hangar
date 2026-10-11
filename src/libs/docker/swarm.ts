import type Dockerode from "dockerode";
import type { Cache, CachePolicy } from "#libs/cache";
import { SwarmDaemonError, SwarmRefusedError } from "./swarm-errors.ts";
import {
  swarmNodeActions,
  swarmNodeRefusal,
  SwarmRefreshMs,
  type SwarmNodeAction,
  type SwarmNodeState,
} from "./swarm-rules/index.ts";

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
  /** What Hangar can change on this node now; see `swarmNodeRefusal`. */
  actions: SwarmNodeAction[];
};

/** The whole cluster, as only a manager's daemon can describe it. */
export type SwarmManagerView = {
  state: "manager";
  clusterId: string;
  currentNodeId: string;
  /** How many managers the cluster has; `faultTolerance` turns it into how many may fail. */
  managers: number;
  /** This node first, then the other managers, then by hostname. */
  nodes: SwarmNode[];
};

/**
 * What a node that cannot describe the cluster knows: whether it is in one at all, and as a worker,
 * the managers' addresses, but nothing of the cluster itself, not even its id.
 */
export type SwarmLimitedView = { state: SwarmLocalState; error: string } | { state: "worker"; managers: string[] };

/** The swarm as this node's daemon sees it. */
export type SwarmCluster = SwarmLimitedView | SwarmManagerView;

/** One task of a stack, current or past, as `docker stack ps` lists it. */
export type SwarmStackTask = {
  id: string;
  /** `<service>.<slot>`, or `<service>.<node id>` for a global service. */
  name: string;
  /** The hostname of the node it was placed on, empty while unassigned. */
  node: string;
  desiredState: string;
  state: string;
  /** When it reached `state`, in ISO 8601. */
  since: string;
  /** Why it failed, as the daemon puts it; empty otherwise. */
  error: string;
};

/** The commands that add a node to the swarm, one per role it joins as. Secret: they carry the tokens. */
export type SwarmJoinCommands = { worker: string; manager: string };

/** What it takes to join an existing swarm. */
export type SwarmJoinRequest = {
  /** A manager's `host:port`, usually on port 2377. */
  managerAddress: string;
  /** The worker or manager token, which decides the role this node joins as. */
  token: string;
  /** The address other nodes reach this one at; the daemon picks one when there is a single choice. */
  advertiseAddress?: string | undefined;
};

/** The `info.Swarm` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type SwarmInfo = {
  Swarm?: {
    LocalNodeState?: string;
    ControlAvailable?: boolean;
    NodeID?: string;
    NodeAddr?: string;
    Error?: string;
    RemoteManagers?: { NodeID: string; Addr: string }[] | null;
    Cluster?: { ID: string };
  };
};

/** The `GET /swarm` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type SwarmInspect = {
  Version: { Index: number };
  Spec: object;
  JoinTokens: { Worker: string; Manager: string };
};

/** The `GET /nodes` fields {@link DockerSwarm} reads; the client hands them back untyped. */
type NodeInfo = {
  ID: string;
  Version?: { Index: number };
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
  ID: string;
  ServiceID: string;
  NodeID?: string;
  Slot?: number;
  DesiredState?: string;
  Status?: { State?: string; Timestamp?: string; Err?: string };
};

/**
 * The swarm this Hangar's daemon belongs to, through the Engine API: its nodes and the stacks each
 * one runs, the few changes a homelab makes to them, and creating or joining one. Compose containers
 * are never part of it.
 *
 * No `server-only` guard: see AGENTS.md § server-only.
 */
export class DockerSwarm {
  /** The prefix the daemon's `node` and `service` events refresh (see `DockerEvents`). */
  private static readonly Prefix = "docker:swarm";

  private static readonly Key = `${DockerSwarm.Prefix}:cluster`;

  /** The port managers listen on for the other nodes, as `docker swarm init` and `join` default it. */
  private static readonly ManagerPort = 2377;

  private static readonly ListenAddress = `0.0.0.0:${DockerSwarm.ManagerPort}`;

  /** Changes to a node's spec, per action; `remove` deletes the node instead. */
  private static readonly SpecChanges: Record<Exclude<SwarmNodeAction, "remove">, object> = {
    promote: { Role: "manager" },
    demote: { Role: "worker" },
    drain: { Availability: "drain" },
    activate: { Availability: "active" },
  };

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
  constructor(docker: Dockerode, cache: Cache, ttl = SwarmRefreshMs) {
    this.docker = docker;
    this.cache = cache;
    // Not kept warm: the TTL is shorter than the warming tick, which could only reload it for nobody.
    // The page's own reloads and the daemon's events keep it current while someone looks.
    this.policy = { ttl, maxStale: DockerSwarm.MaxStale, warm: false };
  }

  /** The swarm as this node sees it; see {@link SwarmCluster}. */
  cluster(): Promise<SwarmCluster> {
    return this.cache.get(DockerSwarm.Key, this.policy, this.loadCluster);
  }

  /**
   * Reloads the cluster after a change this process made, for a caller about to read the new state.
   * The events would get there too, a moment later.
   */
  settle(): Promise<void> {
    return this.cache.refresh(DockerSwarm.Prefix);
  }

  /**
   * Makes this node the first manager of a new swarm.
   * @param advertiseAddress The address other nodes will reach it at; needed when the host has several
   * @returns Rejects with the daemon's error, e.g. when it cannot choose an address on its own
   */
  async init(advertiseAddress?: string): Promise<void> {
    await DockerSwarm.daemon(
      this.docker.swarmInit({ ListenAddr: DockerSwarm.ListenAddress, AdvertiseAddr: advertiseAddress }),
    );

    await this.settle();
  }

  /**
   * Joins an existing swarm, as a worker or a manager depending on the token.
   * @returns Rejects with the daemon's error, e.g. an unreachable manager or a rotated token
   */
  async join({ managerAddress, token, advertiseAddress }: SwarmJoinRequest): Promise<void> {
    await DockerSwarm.daemon(
      this.docker.swarmJoin({
        ListenAddr: DockerSwarm.ListenAddress,
        AdvertiseAddr: advertiseAddress,
        RemoteAddrs: [managerAddress],
        JoinToken: token,
      }),
    );

    await this.settle();
  }

  /**
   * The `docker swarm join` commands for a new node, pointing at this manager. Never cached: they
   * carry the tokens, read only when someone asks to see them.
   */
  async joinCommands(): Promise<SwarmJoinCommands> {
    const [info, swarm] = await DockerSwarm.daemon(
      Promise.all([this.docker.info() as Promise<SwarmInfo>, this.docker.swarmInspect() as Promise<SwarmInspect>]),
    );

    const self = info.Swarm?.RemoteManagers?.find(manager => manager.NodeID === info.Swarm?.NodeID);
    const address = self?.Addr ?? `${info.Swarm?.NodeAddr}:${DockerSwarm.ManagerPort}`;
    const command = (token: string) => `docker swarm join --token ${token} ${address}`;

    return { worker: command(swarm.JoinTokens.Worker), manager: command(swarm.JoinTokens.Manager) };
  }

  /**
   * Replaces a join token, so a leaked one stops working. Nodes already in the swarm are not affected.
   * @param role Which token to replace
   */
  async rotateToken(role: keyof SwarmJoinCommands): Promise<void> {
    const swarm = (await DockerSwarm.daemon(this.docker.swarmInspect())) as SwarmInspect;

    // The update replaces the whole spec, so the current one goes back unchanged, at its version.
    await DockerSwarm.daemon(
      this.docker.swarmUpdate({
        _query: {
          version: swarm.Version.Index,
          rotateWorkerToken: role === "worker",
          rotateManagerToken: role === "manager",
        },
        _body: swarm.Spec,
      }),
    );
  }

  /**
   * Promotes, demotes, drains, reactivates or removes a node, after the same check the page's buttons
   * follow, made against the daemon's current list rather than the cached one.
   * @param nodeId The node's id, from {@link cluster}
   * @returns Rejects with a {@link SwarmRefusedError} when the action does not apply, or with a
   * {@link SwarmDaemonError}, e.g. when a demotion would cost the cluster its quorum
   */
  async changeNode(nodeId: string, action: SwarmNodeAction): Promise<void> {
    const nodes = (await DockerSwarm.daemon(this.docker.listNodes())) as NodeInfo[];
    const target = nodes.find(node => node.ID === nodeId);

    if (!target) {
      throw new SwarmRefusedError("unknown-node", action, nodeId);
    }

    const refusal = swarmNodeRefusal(action, DockerSwarm.nodeState(target), DockerSwarm.managerCount(nodes));

    if (refusal) {
      throw new SwarmRefusedError(refusal, action, nodeId);
    }

    if (action === "remove") {
      await DockerSwarm.daemon(this.docker.getNode(nodeId).remove({}));
    } else {
      // The update replaces the whole spec, so the change is merged over the current one, at its version.
      await DockerSwarm.daemon(
        this.docker.getNode(nodeId).update({
          _query: { version: target.Version?.Index },
          _body: { ...target.Spec, ...DockerSwarm.SpecChanges[action] },
        }),
      );
    }

    await this.settle();
  }

  /**
   * Every task of a stack, or of a lone service by its name, current and past: the failed attempts
   * are what explains a partial stack. By name, then newest first. Never cached: the stack sheet asks
   * for it when opened.
   * @param stack The stack name, as {@link SwarmStackOnNode} gives it
   */
  async stackTasks(stack: string): Promise<SwarmStackTask[]> {
    const services = (await DockerSwarm.daemon(this.docker.listServices())).filter(
      service => DockerSwarm.stackName(service) === stack,
    );

    if (services.length === 0) {
      return [];
    }

    const [tasks, nodes] = await DockerSwarm.daemon(
      Promise.all([
        this.docker.listTasks({ filters: { service: services.map(service => service.ID) } }) as Promise<TaskInfo[]>,
        this.docker.listNodes() as Promise<NodeInfo[]>,
      ]),
    );

    const serviceNames = new Map(services.map(service => [service.ID, service.Spec?.Name ?? service.ID]));
    const hostnames = new Map(nodes.map(node => [node.ID, node.Description?.Hostname ?? node.ID]));

    return tasks
      .map(task => ({
        id: task.ID,
        name: `${serviceNames.get(task.ServiceID)}.${task.Slot ?? task.NodeID}`,
        node: task.NodeID ? (hostnames.get(task.NodeID) ?? task.NodeID) : "",
        desiredState: task.DesiredState ?? "",
        state: task.Status?.State ?? "",
        since: task.Status?.Timestamp ?? "",
        error: task.Status?.Err ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || b.since.localeCompare(a.since));
  }

  /** Awaits an Engine API call, turning the daemon's own refusal into a {@link SwarmDaemonError}. */
  private static async daemon<T>(call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (error) {
      throw SwarmDaemonError.from(error);
    }
  }

  private static managerCount(nodes: NodeInfo[]) {
    return nodes.filter(node => node.Spec?.Role === "manager").length;
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
    const managers = DockerSwarm.managerCount(nodes);

    return {
      state: "manager",
      clusterId: swarm.Cluster?.ID ?? "",
      currentNodeId,
      managers,
      nodes: DockerSwarm.sortNodes(DockerSwarm.nodes(nodes, services, tasks, managers), currentNodeId),
    };
  };

  /**
   * Every node with the stacks it runs. A stack spread over several nodes shows on each of them; its
   * health is the same everywhere, since it counts the whole cluster.
   */
  private static nodes(
    nodes: NodeInfo[],
    services: Dockerode.Service[],
    tasks: TaskInfo[],
    managers: number,
  ): SwarmNode[] {
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

      const state = DockerSwarm.nodeState(node);
      const resources = node.Description?.Resources;

      return {
        id: node.ID,
        hostname: node.Description?.Hostname ?? node.ID,
        ...state,
        cpus: (resources?.NanoCPUs ?? 0) / 1e9,
        memoryBytes: resources?.MemoryBytes ?? 0,
        engineVersion: node.Description?.Engine?.EngineVersion ?? "",
        stacks,
        actions: swarmNodeActions(state, managers),
      };
    });
  }

  /** The fields of a node that decide which actions apply to it. */
  private static nodeState(node: NodeInfo): SwarmNodeState {
    return {
      role: DockerSwarm.role(node),
      status: node.Status?.State ?? "unknown",
      availability: node.Spec?.Availability ?? "active",
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
