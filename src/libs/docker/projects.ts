import "server-only";

import type Docker from "dockerode";
import { HangarError } from "#libs/hangar";
import { docker } from "./client.ts";

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
};

/** Response body for the "list all projects" endpoint. */
export type ComposeProjectsSnapshot = { projects: ComposeProjectSummary[] };

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

/** Labels Docker Compose stamps on every container it creates; used to discover and group projects. */
export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
export const COMPOSE_CONTAINER_NUMBER_LABEL = "com.docker.compose.container-number";
export const COMPOSE_ONEOFF_LABEL = "com.docker.compose.oneoff";

/**
 * A Compose container seen through both Engine API views. The list entry already carries labels,
 * state, image and structured ports; the inspect adds the healthcheck and the restart count,
 * which the list only exposes inside a human-readable status string.
 */
export type ComposeContainerSource = { info: Docker.ContainerInfo; detail: Docker.ContainerInspectInfo };

const textCompare = (left: string, right: string) => left.localeCompare(right, "en");

/** True for containers from a one-off run (e.g. `docker compose run`), which aren't part of the service topology. */
export const isComposeOneoff = (labels: Record<string, string>) =>
  labels[COMPOSE_ONEOFF_LABEL]?.toLowerCase() === "true";

/** Reads Docker's structured healthcheck state; `none` when the container declares no healthcheck. */
export const containerHealth = ({ detail }: ComposeContainerSource): ContainerHealth => {
  const health = detail.State.Health?.Status;

  return health === "healthy" || health === "unhealthy" || health === "starting" ? health : "none";
};

/**
 * Rolls up container counts into one {@link ComposeProjectStatus} for a project or service.
 * Any unhealthy container wins; otherwise it's running/stopped/partial by count.
 */
export function projectStatus(
  containerCount: number,
  runningCount: number,
  unhealthyCount: number,
): ComposeProjectStatus {
  if (unhealthyCount > 0) return "unhealthy";
  if (containerCount > 0 && runningCount === containerCount) return "running";
  if (runningCount === 0) return "stopped";
  return "partial";
}

/**
 * Groups a flat container list by Compose project label into one summary per project, sorted by name.
 * Only apps Hangar installed are kept, and every installed app gets a row even when it has no
 * container yet (never started, or removed by `compose down`).
 * @param containers Compose-managed containers, already filtered by {@link composeManaged}
 * @param installedProjects Project names Hangar installed and can run compose commands against
 */
export function buildComposeProjectSummaries(
  containers: ComposeContainerSource[],
  installedProjects: ReadonlySet<string>,
): ComposeProjectSummary[] {
  const projects = new Map<
    string,
    { services: Set<string>; containerIds: string[]; runningCount: number; unhealthyCount: number }
  >();

  for (const container of containers) {
    const labels = container.info.Labels;
    const project = labels[COMPOSE_PROJECT_LABEL] ?? "";
    const service = labels[COMPOSE_SERVICE_LABEL] ?? "";

    if (installedProjects.has(project)) {
      const aggregate = projects.get(project) ?? {
        services: new Set<string>(),
        containerIds: [],
        runningCount: 0,
        unhealthyCount: 0,
      };

      aggregate.services.add(service);
      aggregate.containerIds.push(container.info.Id);
      aggregate.runningCount += container.info.State === "running" ? 1 : 0;
      aggregate.unhealthyCount += containerHealth(container) === "unhealthy" ? 1 : 0;
      projects.set(project, aggregate);
    }
  }

  for (const name of installedProjects) {
    if (!projects.has(name)) {
      projects.set(name, { services: new Set(), containerIds: [], runningCount: 0, unhealthyCount: 0 });
    }
  }

  return [...projects.entries()]
    .map(([name, aggregate]) => ({
      name,
      status: projectStatus(aggregate.containerIds.length, aggregate.runningCount, aggregate.unhealthyCount),
      serviceCount: aggregate.services.size,
      containerCount: aggregate.containerIds.length,
      runningCount: aggregate.runningCount,
      stoppedCount: aggregate.containerIds.length - aggregate.runningCount,
      unhealthyCount: aggregate.unhealthyCount,
      containerIds: aggregate.containerIds,
    }))
    .sort((left, right) => textCompare(left.name, right.name));
}

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

/**
 * Lists every Compose-labeled container, or just one project's, in both API views. The daemon
 * applies the label filter itself, and an inspect costs a few milliseconds over the socket, so
 * they all go out at once.
 * @param project When set, only that Compose project's containers
 */
export async function inspectComposeContainers(project?: string): Promise<ComposeContainerSource[]> {
  const label = project ? `${COMPOSE_PROJECT_LABEL}=${project}` : COMPOSE_PROJECT_LABEL;
  const listed = await docker.listContainers({ all: true, filters: { label: [label] } });

  return Promise.all(listed.map(async info => ({ info, detail: await docker.getContainer(info.Id).inspect() })));
}

/** Keeps only containers that belong to a Compose service and aren't from a one-off run. */
export const composeManaged = (containers: ComposeContainerSource[], project?: string) =>
  containers.filter(container => {
    const labels = container.info.Labels;

    return (
      Boolean(labels[COMPOSE_PROJECT_LABEL]) &&
      Boolean(labels[COMPOSE_SERVICE_LABEL]) &&
      !isComposeOneoff(labels) &&
      (!project || labels[COMPOSE_PROJECT_LABEL] === project)
    );
  });

/**
 * Lists every app Hangar installed, as lightweight summaries of their Docker state.
 * @param installedProjects Project names Hangar installed and can run compose commands against
 */
export async function listComposeProjects(installedProjects: ReadonlySet<string>): Promise<ComposeProjectsSnapshot> {
  const containers = await inspectComposeContainers();

  return { projects: buildComposeProjectSummaries(composeManaged(containers), installedProjects) };
}

/** Parses the Compose replica index label, or `null` when absent/unparseable. */
const parseReplica = (labels: Record<string, string>) => {
  const replica = Number.parseInt(labels[COMPOSE_CONTAINER_NUMBER_LABEL] ?? "", 10);
  return Number.isFinite(replica) ? replica : null;
};

/** Keeps only ports actually published to the host, sorted by host port. */
const publishedPorts = (ports: Docker.Port[]) =>
  ports.filter(port => port.PublicPort).sort((left, right) => left.PublicPort - right.PublicPort);

/** Builds the UI-facing container shape. Resource usage is not here: it arrives over the stats stream. */
function toComposeContainer({ info, detail }: ComposeContainerSource): ComposeContainer {
  const labels = info.Labels;

  return {
    id: info.Id,
    name: (info.Names[0] ?? "").replace(/^\//, ""),
    service: labels[COMPOSE_SERVICE_LABEL] ?? "unknown",
    replica: parseReplica(labels),
    image: info.Image,
    state: info.State,
    health: containerHealth({ info, detail }),
    restartCount: detail.RestartCount ?? null,
    ports: publishedPorts(info.Ports),
  };
}

/** Groups containers by service name into {@link ComposeService} entries, sorted by name. */
const buildServices = (containers: ComposeContainer[]): ComposeService[] => {
  const grouped = Map.groupBy(containers, container => container.service);

  return [...grouped.entries()]
    .map(([name, serviceContainers]) => {
      const sortedContainers = serviceContainers.sort(
        (left, right) =>
          (left.replica ?? Number.MAX_SAFE_INTEGER) - (right.replica ?? Number.MAX_SAFE_INTEGER) ||
          textCompare(left.name, right.name),
      );
      const runningCount = sortedContainers.filter(container => container.state === "running").length;
      const unhealthyCount = sortedContainers.filter(container => container.health === "unhealthy").length;

      return {
        name,
        status: projectStatus(sortedContainers.length, runningCount, unhealthyCount),
        containerCount: sortedContainers.length,
        runningCount,
        unhealthyCount,
        containers: sortedContainers,
      };
    })
    .sort((left, right) => textCompare(left.name, right.name));
};

/**
 * Fetches the topology (services, containers, ports) of one installed app. No resource usage:
 * that is sampled separately and arrives over the stats stream.
 * An installed app with no container yet resolves to a stopped project with no service.
 * @param project The Compose project name
 * @param installedProjects Project names Hangar installed and can run compose commands against
 * @throws {DockerNotFoundError} if the project is not an installed app
 */
export async function getComposeProjectDetail(
  project: string,
  installedProjects: ReadonlySet<string>,
): Promise<ComposeProjectDetail> {
  const containers = composeManaged(await inspectComposeContainers(project), project);
  // One name in, one summary out: an app Hangar didn't install yields none, and reads as not found.
  const [summary] = buildComposeProjectSummaries(containers, new Set(installedProjects.has(project) ? [project] : []));

  if (!summary) throw new DockerNotFoundError(`Compose project ${project}`);

  return { ...summary, services: buildServices(containers.map(toComposeContainer)) };
}
