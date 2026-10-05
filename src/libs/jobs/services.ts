import type { Docker } from "#libs/docker";
import type { Hangar } from "#libs/hangar";
import type { Notifications } from "#libs/notifications";

/** What a job works with: the installed apps, the daemon, and the notification centre. */
export type JobServices = {
  hangar: Hangar;
  docker: Docker;
  notifications: Notifications;
};

/**
 * Builds a job's services when its run starts. A factory rather than the services themselves:
 * Sidequest constructs a job in the web server too, to enqueue it, and only the worker should
 * open them.
 */
export type CreateJobServices = () => Promise<JobServices>;
