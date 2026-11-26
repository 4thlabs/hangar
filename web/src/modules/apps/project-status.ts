import type { ContainerHealth, ContainerState, ProjectContainer, ProjectStatus } from "#libs/api";

// How the page shows how an app, a service or a container runs.

/** What each status is called, as the Waku version calls it. */
export const projectStatusLabels: Readonly<Record<ProjectStatus, string>> = {
  running: "Running",
  partial: "Partial",
  stopped: "Stopped",
  unhealthy: "Degraded",
};

/** What a healthcheck's word is. */
export const healthLabels: Readonly<Record<ContainerHealth, string>> = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  starting: "Starting",
};

/** What each state of a container is called. */
export const containerStateLabels: Readonly<Record<ContainerState, string>> = {
  created: "Created",
  running: "Running",
  paused: "Paused",
  restarting: "Restarting",
  exited: "Exited",
  removing: "Removing",
  dead: "Dead",
  unknown: "Unknown",
};

/** The badge of a status: destructive when unhealthy, outlined when partial. */
export function statusBadgeVariant(status: ProjectStatus) {
  if (status === "unhealthy") {
    return "destructive" as const;
  }

  if (status === "partial") {
    return "outline" as const;
  }

  return "secondary" as const;
}

/** What a container's badge says: its healthcheck when it has one, its state otherwise. */
export function containerStatusLabel(container: ProjectContainer): string {
  return container.health ? healthLabels[container.health] : containerStateLabels[container.state];
}

/** Whether a container's badge is destructive: an unhealthy or dead container. */
export function isContainerFailing(container: ProjectContainer): boolean {
  return container.health === "unhealthy" || container.state === "dead";
}
