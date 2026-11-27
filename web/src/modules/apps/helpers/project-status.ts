import type { ProjectContainer, ProjectStatus } from "#libs/api";
import { appsMessages } from "#modules/apps/messages.ts";

// How the page shows how an app, a service or a container runs.

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
  return container.health ? appsMessages.health[container.health] : appsMessages.containerState[container.state];
}

/** Whether a container's badge is destructive: an unhealthy or dead container. */
export function isContainerFailing(container: ProjectContainer): boolean {
  return container.health === "unhealthy" || container.state === "dead";
}
