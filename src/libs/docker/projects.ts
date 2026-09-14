import "server-only";

import { HangarError, type CommandRunner } from "#libs/hangar";
import { logger } from "#libs/logs";
import { containerMetrics, EMPTY_CONTAINER_METRICS, type DockerStatsLine } from "./stats.ts";
import type {
  ComposeContainer,
  ComposeProjectDetail,
  ComposeProjectStatus,
  ComposeProjectSummary,
  ComposeProjectsSnapshot,
  ComposeService,
  ContainerHealth,
  PublishedPort,
} from "./types.ts";

/** Labels Docker Compose stamps on every container it creates; used to discover and group projects. */
export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
export const COMPOSE_CONTAINER_NUMBER_LABEL = "com.docker.compose.container-number";
export const COMPOSE_ONEOFF_LABEL = "com.docker.compose.oneoff";

/** The subset of `docker inspect` output this module reads. */
export type InspectedContainer = {
  Id: string;
  Name: string;
  RestartCount: number;
  State: { Status: string; Health?: { Status: string } };
  Config: { Image: string; Labels: Record<string, string> };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
};

/** `docker stats` and `docker ps` report a 12-character id; `docker inspect` reports the full one. */
const shortId = (id: string) => id.slice(0, 12);

/**
 * Runs a `docker` command and parses its newline-delimited JSON output, the shape
 * `--format '{{json .}}'` produces. The runner already decides what a failure is:
 * a command that printed nothing rejects, a partial success comes back parseable.
 */
async function dockerJson<T>(runner: CommandRunner, args: string[]): Promise<T[]> {
  const { stdout } = await runner.run("docker", args, { capture: true });

  return stdout.split("\n").flatMap(line => (line.trim() ? [JSON.parse(line) as T] : []));
}

const textCompare = (left: string, right: string) => left.localeCompare(right, "en");

/** True for containers from a one-off run (e.g. `docker compose run`), which aren't part of the service topology. */
export const isComposeOneoff = (labels: Record<string, string>) =>
  labels[COMPOSE_ONEOFF_LABEL]?.toLowerCase() === "true";

/** Reads Docker's structured healthcheck state; `none` when the container declares no healthcheck. */
export const containerHealth = (container: InspectedContainer): ContainerHealth => {
  const health = container.State.Health?.Status;

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
  containers: InspectedContainer[],
  installedProjects: ReadonlySet<string>,
): ComposeProjectSummary[] {
  const projects = new Map<
    string,
    { services: Set<string>; containerCount: number; runningCount: number; unhealthyCount: number }
  >();

  for (const container of containers) {
    const labels = container.Config.Labels;
    const project = labels[COMPOSE_PROJECT_LABEL] ?? "";
    const service = labels[COMPOSE_SERVICE_LABEL] ?? "";

    if (installedProjects.has(project)) {
      const aggregate = projects.get(project) ?? {
        services: new Set<string>(),
        containerCount: 0,
        runningCount: 0,
        unhealthyCount: 0,
      };

      aggregate.services.add(service);
      aggregate.containerCount += 1;
      aggregate.runningCount += container.State.Status === "running" ? 1 : 0;
      aggregate.unhealthyCount += containerHealth(container) === "unhealthy" ? 1 : 0;
      projects.set(project, aggregate);
    }
  }

  for (const name of installedProjects) {
    if (!projects.has(name)) {
      projects.set(name, { services: new Set(), containerCount: 0, runningCount: 0, unhealthyCount: 0 });
    }
  }

  return [...projects.entries()]
    .map(([name, aggregate]) => ({
      name,
      status: projectStatus(aggregate.containerCount, aggregate.runningCount, aggregate.unhealthyCount),
      serviceCount: aggregate.services.size,
      containerCount: aggregate.containerCount,
      runningCount: aggregate.runningCount,
      stoppedCount: aggregate.containerCount - aggregate.runningCount,
      unhealthyCount: aggregate.unhealthyCount,
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
 * Lists and inspects every Compose-labeled container, or just one project's.
 * One `docker inspect` call covers them all: labels, state, healthcheck and ports
 * all come back structured, so nothing has to be scraped from a human-readable string.
 *
 * ponytail: every id goes into a single `docker inspect` argv, which caps this at a few
 * thousand containers on a normal host. Chunk the id list if one ever gets that big.
 * @param runner Runs the `docker` commands
 * @param project When set, only that Compose project's containers
 */
export async function inspectComposeContainers(runner: CommandRunner, project?: string): Promise<InspectedContainer[]> {
  const label = project ? `${COMPOSE_PROJECT_LABEL}=${project}` : COMPOSE_PROJECT_LABEL;
  const listed = await runner.run("docker", ["ps", "-a", "--filter", `label=${label}`, "--format", "{{.ID}}"], {
    capture: true,
  });
  const ids = listed.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (ids.length === 0) return [];

  return dockerJson<InspectedContainer>(runner, ["inspect", ...ids, "--format", "{{json .}}"]);
}

/** Keeps only containers that belong to a Compose service and aren't from a one-off run. */
const composeManaged = (containers: InspectedContainer[], project?: string) =>
  containers.filter(container => {
    const labels = container.Config.Labels;

    return (
      Boolean(labels[COMPOSE_PROJECT_LABEL]) &&
      Boolean(labels[COMPOSE_SERVICE_LABEL]) &&
      !isComposeOneoff(labels) &&
      (!project || labels[COMPOSE_PROJECT_LABEL] === project)
    );
  });

/**
 * Lists every app Hangar installed, as lightweight summaries of their Docker state.
 * @param runner Runs the `docker` commands
 * @param installedProjects Project names Hangar installed and can run compose commands against
 */
export async function listComposeProjects(
  runner: CommandRunner,
  installedProjects: ReadonlySet<string>,
): Promise<ComposeProjectsSnapshot> {
  const containers = await inspectComposeContainers(runner);

  return {
    sampledAt: new Date().toISOString(),
    projects: buildComposeProjectSummaries(composeManaged(containers), installedProjects),
  };
}

/** Parses the Compose replica index label, or `null` when absent/unparseable. */
const parseReplica = (labels: Record<string, string>) => {
  const replica = Number.parseInt(labels[COMPOSE_CONTAINER_NUMBER_LABEL] ?? "", 10);
  return Number.isFinite(replica) ? replica : null;
};

/** Keeps only ports actually published to the host, sorted by host port. */
const publishedPorts = (ports: InspectedContainer["NetworkSettings"]["Ports"]): PublishedPort[] =>
  Object.entries(ports ?? {})
    .flatMap(([portSpec, bindings]) => {
      const [containerPort = "", protocol = "tcp"] = portSpec.split("/");

      return (bindings ?? []).map(binding => ({
        hostIp: binding.HostIp || "0.0.0.0",
        hostPort: Number.parseInt(binding.HostPort, 10),
        containerPort: Number.parseInt(containerPort, 10),
        protocol,
      }));
    })
    .filter(port => Number.isFinite(port.hostPort))
    .sort((left, right) => left.hostPort - right.hostPort);

/**
 * Takes one live stats sample for the given containers, keyed by the short id `docker stats`
 * reports. Returns `null` when the sample fails, so the caller can mark the snapshot partial.
 *
 * This costs 1-2 seconds however it is asked for: a CPU percentage is a delta, so the daemon
 * itself waits between two samples. Keep it off anything a page render blocks on.
 */
async function sampleStats(runner: CommandRunner, ids: string[]): Promise<Map<string, DockerStatsLine> | null> {
  if (ids.length === 0) return new Map();

  try {
    const lines = await dockerJson<DockerStatsLine>(runner, ["stats", "--no-stream", "--format", "{{json .}}", ...ids]);

    return new Map(lines.map(line => [shortId(line.ID), line]));
  } catch (error) {
    logger.warn({ error }, "Docker container statistics failed");
    return null;
  }
}

/** Builds the UI-facing container shape, attaching a live stats sample when one was taken. */
function toComposeContainer(container: InspectedContainer, stats: DockerStatsLine | undefined): ComposeContainer {
  const labels = container.Config.Labels;

  return {
    id: container.Id,
    name: container.Name.replace(/^\//, ""),
    service: labels[COMPOSE_SERVICE_LABEL] ?? "unknown",
    replica: parseReplica(labels),
    image: container.Config.Image,
    state: container.State.Status,
    health: containerHealth(container),
    restartCount: container.RestartCount ?? null,
    ports: publishedPorts(container.NetworkSettings.Ports),
    metrics: stats ? containerMetrics(stats) : EMPTY_CONTAINER_METRICS,
    metricsAvailable: stats !== undefined,
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
 * Fetches full detail (services, containers, live metrics) for one installed app.
 * An installed app with no container yet resolves to a stopped project with no service.
 * @param runner Runs the `docker` commands
 * @param project The Compose project name
 * @param installedProjects Project names Hangar installed and can run compose commands against
 * @param sampleMetrics Whether to take a live stats sample; see {@link sampleStats} for its cost
 * @throws {DockerNotFoundError} if the project is not an installed app
 */
export async function getComposeProjectDetail(
  runner: CommandRunner,
  project: string,
  installedProjects: ReadonlySet<string>,
  sampleMetrics = true,
): Promise<ComposeProjectDetail> {
  const containers = composeManaged(await inspectComposeContainers(runner, project), project);
  const summary = buildComposeProjectSummaries(containers, installedProjects).find(entry => entry.name === project);

  if (!summary) throw new DockerNotFoundError(`Compose project ${project}`);

  // No ids means no sample and no cost: skipping metrics needs no separate branch.
  const running = sampleMetrics ? containers.filter(container => container.State.Status === "running") : [];
  const stats = await sampleStats(
    runner,
    running.map(container => container.Id),
  );

  return {
    ...summary,
    sampledAt: new Date().toISOString(),
    services: buildServices(
      containers.map(container => toComposeContainer(container, stats?.get(shortId(container.Id)))),
    ),
    partial: stats === null,
  };
}
