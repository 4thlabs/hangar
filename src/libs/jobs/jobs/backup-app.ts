import { hostname } from "node:os";
import { Job } from "sidequest";
import type { BackupSummary } from "#libs/backups";
import type { Docker } from "#libs/docker";
import { HangarError } from "#libs/hangar";
import { logger } from "#libs/logs";
import { NotificationText } from "#modules/notifications/notification-text.ts";
import type { CreateJobServices, JobServices } from "../services.ts";
import { createWorkerServices } from "../worker.ts";

/** What one backup run wrote, kept in the job's `result` column. */
export type BackupReport = BackupSummary & {
  ranAt: string;
  app: string;
  /** The services stopped for the run, then started again */
  stopped: string[];
};

/**
 * Archives an app's data folder, as its `backups` entry in hangar.yml says: on its schedule, and by
 * hand from the app's page. With `stop`, the services running then are stopped while the files are
 * read, and started again whatever the outcome.
 */
export class BackupApp extends Job {
  /**
   * The hostname Docker gives a container, its short id. A container on the host network, or given
   * a hostname of its own, does not have it: Hangar cannot tell it is the one it runs in.
   */
  private static readonly ContainerHostname = /^[0-9a-f]{12}$/;

  /** Builds what the run works with. */
  private readonly createServices: CreateJobServices;

  /**
   * @param createServices The worker's own services by default, as Sidequest constructs the job
   * with no arguments; a test passes its doubles
   */
  constructor(createServices: CreateJobServices = createWorkerServices) {
    super();
    this.createServices = createServices;
  }

  /**
   * Backs up one app and returns what was written. A failure is notified, then rethrown so the run
   * shows as failed in the Jobs settings.
   * @param app The app id
   */
  async run(app: string): Promise<BackupReport> {
    const services = await this.createServices();
    // Set once known, so the `finally` starts again exactly what this run stopped.
    let running: string[] = [];

    try {
      const config = services.hangar.store.config.backup(app);

      if (!config) {
        throw new HangarError(`hangar.yml declares no backup for ${app}`);
      }

      running = config.stop ? await BackupApp.runningServices(services.docker, app) : [];

      if (running.length > 0) {
        await services.hangar.store.compose(app, ["stop", ...running]);
      }

      const summary = await services.backups.create(config, this.abortSignal);

      logger.info(`Backed up ${app}: ${summary.files} file(s) into ${summary.archive}`);

      return { ranAt: new Date().toISOString(), app, ...summary, stopped: running };
    } catch (error) {
      logger.error("Backup failed", { error, app });

      await services.notifications.notify({
        level: "error",
        message: NotificationText.create("backupFailed", { app, error: (error as Error).message }),
        href: `/apps/${app}`,
        dedupeKey: `backup:${app}`,
      });

      throw error;
    } finally {
      if (running.length > 0) {
        await BackupApp.restart(services, app, running);
      }
    }
  }

  /**
   * The services of an app with a container running: the only ones to stop, and so to start again.
   * @throws HangarError when one of them is the container Hangar itself runs in
   */
  private static async runningServices(docker: Docker, app: string) {
    const detail = await docker.projectDetail(app);
    const running = detail.services.filter(service => service.runningCount > 0);
    const self = hostname();
    // Only a hostname shaped like a short id can name a container: a host called `cafe` would match some.
    const isSelf = (id: string) => BackupApp.ContainerHostname.test(self) && id.startsWith(self);

    if (running.some(service => service.containers.some(container => isSelf(container.id)))) {
      throw new HangarError(`${app} runs Hangar itself: stopping it would stop its own backup`);
    }

    return running.map(service => service.name);
  }

  /** Starts the services the run stopped; an app left down is notified on its own, then rethrown. */
  private static async restart({ hangar, notifications }: JobServices, app: string, stopped: string[]) {
    try {
      await hangar.store.compose(app, ["start", ...stopped]);
    } catch (error) {
      logger.error("Restart after backup failed", { error, app, stopped });

      await notifications.notify({
        level: "error",
        message: NotificationText.create("backupRestartFailed", { app, services: stopped.join(", ") }),
        href: `/apps/${app}`,
        dedupeKey: `backup-restart:${app}`,
      });

      throw error;
    }
  }
}
