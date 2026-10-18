import { hostname } from "node:os";
import { Job } from "sidequest";
import type { BackupSummary } from "#libs/backups";
import type { Docker } from "#libs/docker";
import { HangarError } from "#libs/hangar";
import { logger } from "#libs/logs";
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
    const config = services.hangar.store.config.backup(app);

    if (!config) {
      throw new HangarError(`hangar.yml declares no backup for ${app}`);
    }

    const running = config.stop ? await BackupApp.runningServices(services.docker, app) : [];

    try {
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
        title: "Sauvegarde échouée",
        description: `La sauvegarde de ${app} a échoué : ${(error as Error).message}`,
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
    // Docker names a container's host after its short id; outside a container, no id matches.
    const self = hostname();

    if (running.some(service => service.containers.some(container => container.id.startsWith(self)))) {
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
        title: "Application arrêtée",
        description: `${app} n’a pas redémarré après sa sauvegarde : ${stopped.join(", ")}.`,
        href: `/apps/${app}`,
        dedupeKey: `backup-restart:${app}`,
      });

      throw error;
    }
  }
}
