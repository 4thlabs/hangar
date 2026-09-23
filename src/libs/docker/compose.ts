import type Docker from "dockerode";
import { HangarError } from "#libs/hangar";

/** Aggregate run state of a Compose project or service. */
export type ComposeProjectStatus = "running" | "partial" | "stopped" | "unhealthy";

/** Docker healthcheck state of a single container. */
export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

/** Lightweight per-project summary, cheap enough to compute for every project on the overview page. */
export type ComposeProjectSummary = {
  name: string;
  status: ComposeProjectStatus;
  serviceCount: number;
  containerCount: number;
  runningCount: number;
  stoppedCount: number;
  unhealthyCount: number;
  /** Full ids of this project's containers, so a client can pick its rows out of the stats stream. */
  containerIds: string[];
  /**
   * Whether the last image check found this app behind its registry. Set by the page from that
   * report, not by the Docker layer: `undefined` simply means no check has run yet.
   */
  updateAvailable?: boolean;
  /** Store icon of the app, when the store carries one. Set by the page, like `updateAvailable`. */
  icon?: string | undefined;
  /** Category the stack belongs to in `hangar.yml`. Set by the page, like `icon`. */
  category?: { name: string; color: string } | undefined;
};

/** Response body for the "list all projects" endpoint. */
export type ComposeProjectsSnapshot = { projects: ComposeProjectSummary[] };

/** Whether the registry still serves what a container runs, as far as we could tell. */
export type ImageUpdateStatus = "current" | "outdated" | "unknown";

/** One image an installed app runs, and whether the registry has a newer one. */
export type ImageUpdate = {
  project: string;
  /** The reference as Compose runs it, e.g. `nginx:alpine`. */
  image: string;
  status: ImageUpdateStatus;
};

/** What `CheckImageVersion` leaves behind as its job result. */
export type ImageUpdateReport = { checkedAt: string; updates: ImageUpdate[] };

/** Full detail for one container, as shown on the project detail page. */
export type ComposeContainer = {
  id: string;
  name: string;
  service: string;
  /** Compose replica index (`container-number` label), or `null` when absent/unparseable. */
  replica: number | null;
  image: string;
  state: string;
  health: ContainerHealth;
  restartCount: number | null;
  /** Host-published ports only, as the Engine API reports them. */
  ports: Docker.Port[];
};

/** One Compose service (a named group of container replicas) within a project. */
export type ComposeService = {
  name: string;
  status: ComposeProjectStatus;
  containerCount: number;
  runningCount: number;
  unhealthyCount: number;
  containers: ComposeContainer[];
};

/** Full detail for one Compose project, as shown on the project detail page. */
export type ComposeProjectDetail = ComposeProjectSummary & { services: ComposeService[] };

/**
 * A Compose container seen through both Engine API views. The list entry already carries labels,
 * state, image and structured ports; the inspect adds the healthcheck and the restart count,
 * which the list only exposes inside a human-readable status string.
 */
export type ComposeContainerSource = { info: Docker.ContainerInfo; detail: Docker.ContainerInspectInfo };

/**
 * Thrown when a requested Docker subject doesn't exist, or isn't one the caller may see.
 * A `HangarError` so the CLI's error mapping covers the docker layer too, rather than logging
 * these as unexpected defects.
 */
export class DockerNotFoundError extends HangarError {
  constructor(subject: string) {
    super(`Docker: ${subject} not found`);
    this.name = "DockerNotFoundError";
  }
}

/** Running totals for one project or service, before they become a summary. */
type Aggregate = { services: Set<string>; containerIds: string[]; runningCount: number; unhealthyCount: number };

/**
 * The Compose topology read out of a set of containers: which projects exist, which services they
 * run, and what state each is in. Pure — it holds the two Engine API views it was handed and
 * derives everything from them, so it never touches the daemon and is safe to construct anywhere.
 *
 * The views it returns are plain objects on purpose, not instances: they cross the RSC boundary
 * into client components, and that serialization does not carry classes.
 */
export class ComposeProjects {
  /** Labels Docker Compose stamps on every container it creates; used to discover and group projects. */
  static readonly LABEL = {
    project: "com.docker.compose.project",
    service: "com.docker.compose.service",
    containerNumber: "com.docker.compose.container-number",
    oneoff: "com.docker.compose.oneoff",
  } as const;

  /** Compose-managed containers only, narrowed to one project when the constructor was given one. */
  private readonly containers: ComposeContainerSource[];

  /**
   * @param containers Containers as listed and inspected, in any state and unfiltered
   * @param project When set, narrows to that Compose project
   */
  constructor(containers: ComposeContainerSource[], project?: string) {
    this.containers = containers.filter(container => ComposeProjects.isManaged(container, project));
  }

  /**
   * Keeps only containers that belong to a Compose service and aren't from a one-off run
   * (e.g. `docker compose run`), which aren't part of the service topology.
   */
  private static isManaged({ info }: ComposeContainerSource, project?: string) {
    const labels = info.Labels;

    return (
      Boolean(labels[ComposeProjects.LABEL.project]) &&
      Boolean(labels[ComposeProjects.LABEL.service]) &&
      labels[ComposeProjects.LABEL.oneoff]?.toLowerCase() !== "true" &&
      (!project || labels[ComposeProjects.LABEL.project] === project)
    );
  }

  private static compare(left: string, right: string) {
    return left.localeCompare(right, "en");
  }

  /** Reads Docker's structured healthcheck state; `none` when the container declares no healthcheck. */
  private static health({ detail }: ComposeContainerSource): ContainerHealth {
    const health = detail.State.Health?.Status;

    return health === "healthy" || health === "unhealthy" || health === "starting" ? health : "none";
  }

  /**
   * Rolls up container counts into one {@link ComposeProjectStatus} for a project or service.
   * Any unhealthy container wins; otherwise it's running/stopped/partial by count.
   */
  private static status(containerCount: number, runningCount: number, unhealthyCount: number): ComposeProjectStatus {
    if (unhealthyCount > 0) return "unhealthy";
    if (containerCount > 0 && runningCount === containerCount) return "running";
    if (runningCount === 0) return "stopped";
    return "partial";
  }

  /** Parses the Compose replica index label, or `null` when absent/unparseable. */
  private static replica(labels: Record<string, string>) {
    const replica = Number.parseInt(labels[ComposeProjects.LABEL.containerNumber] ?? "", 10);
    return Number.isFinite(replica) ? replica : null;
  }

  /** Keeps only ports actually published to the host, sorted by host port. */
  private static publishedPorts(ports: Docker.Port[]) {
    return ports.filter(port => port.PublicPort).sort((left, right) => left.PublicPort - right.PublicPort);
  }

  /** Builds the UI-facing container shape. Resource usage is not here: it arrives over the stats stream. */
  private static container(source: ComposeContainerSource): ComposeContainer {
    const { info, detail } = source;
    const labels = info.Labels;

    return {
      id: info.Id,
      name: (info.Names[0] ?? "").replace(/^\//, ""),
      service: labels[ComposeProjects.LABEL.service] ?? "unknown",
      replica: ComposeProjects.replica(labels),
      image: info.Image,
      state: info.State,
      health: ComposeProjects.health(source),
      restartCount: detail.RestartCount ?? null,
      ports: ComposeProjects.publishedPorts(info.Ports),
    };
  }

  /** The container this id is a prefix of, if it is one of these. */
  find(containerId: string): ComposeContainerSource | undefined {
    return this.containers.find(candidate => candidate.info.Id.startsWith(containerId));
  }

  /**
   * One summary per installed project, sorted by name. Only apps Hangar installed are kept, and
   * every installed app gets a row even when it has no container yet (never started, or removed
   * by `compose down`).
   * @param installed Project names Hangar installed and can run compose commands against
   */
  summaries(installed: ReadonlySet<string>): ComposeProjectSummary[] {
    const projects = new Map<string, Aggregate>(
      [...installed].map(name => [name, { services: new Set(), containerIds: [], runningCount: 0, unhealthyCount: 0 }]),
    );

    for (const container of this.containers) {
      const labels = container.info.Labels;
      const aggregate = projects.get(labels[ComposeProjects.LABEL.project] ?? "");
      if (!aggregate) continue;

      aggregate.services.add(labels[ComposeProjects.LABEL.service] ?? "");
      aggregate.containerIds.push(container.info.Id);
      aggregate.runningCount += container.info.State === "running" ? 1 : 0;
      aggregate.unhealthyCount += ComposeProjects.health(container) === "unhealthy" ? 1 : 0;
    }

    return [...projects.entries()]
      .map(([name, aggregate]) => ({
        name,
        status: ComposeProjects.status(aggregate.containerIds.length, aggregate.runningCount, aggregate.unhealthyCount),
        serviceCount: aggregate.services.size,
        containerCount: aggregate.containerIds.length,
        runningCount: aggregate.runningCount,
        stoppedCount: aggregate.containerIds.length - aggregate.runningCount,
        unhealthyCount: aggregate.unhealthyCount,
        containerIds: aggregate.containerIds,
      }))
      .sort((left, right) => ComposeProjects.compare(left.name, right.name));
  }

  /** Groups the containers by service name, replicas in index order, services sorted by name. */
  services(): ComposeService[] {
    const grouped = Map.groupBy(this.containers.map(ComposeProjects.container), container => container.service);

    return [...grouped.entries()]
      .map(([name, containers]) => {
        const sorted = containers.sort(
          (left, right) =>
            (left.replica ?? Number.MAX_SAFE_INTEGER) - (right.replica ?? Number.MAX_SAFE_INTEGER) ||
            ComposeProjects.compare(left.name, right.name),
        );
        const runningCount = sorted.filter(container => container.state === "running").length;
        const unhealthyCount = sorted.filter(container => container.health === "unhealthy").length;

        return {
          name,
          status: ComposeProjects.status(sorted.length, runningCount, unhealthyCount),
          containerCount: sorted.length,
          runningCount,
          unhealthyCount,
          containers: sorted,
        };
      })
      .sort((left, right) => ComposeProjects.compare(left.name, right.name));
  }

  /**
   * The full topology of one project: its summary plus its services.
   * An installed app with no container yet resolves to a stopped project with no service.
   * @param project The Compose project name
   * @param installed Project names Hangar installed and can run compose commands against
   * @throws {DockerNotFoundError} if the project is not an installed app
   */
  detail(project: string, installed: ReadonlySet<string>): ComposeProjectDetail {
    // One name in, one summary out: an app Hangar didn't install yields none, and reads as not found.
    const [summary] = this.summaries(new Set(installed.has(project) ? [project] : []));

    if (!summary) throw new DockerNotFoundError(`Compose project ${project}`);

    return { ...summary, services: this.services() };
  }
}
