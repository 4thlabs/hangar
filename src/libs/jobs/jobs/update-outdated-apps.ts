import { Job } from "sidequest";
import { logger } from "#libs/logs";
import type { CreateJobServices, JobServices } from "../services.ts";
import { createWorkerServices } from "../worker.ts";

/** What one auto-update run did, kept in the job's `result` column for the Jobs settings table. */
export type AutoUpdateReport = { ranAt: string; updated: string[]; failed: string[] };

/**
 * Pulls and recreates every running app whose registry serves something newer, except those
 * `hangar.yml` declares with `update: false`.

 * Runs nightly on its own schedule, and by hand from Settings > JOBS.
 */
export class UpdateOutdatedApps extends Job {
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
   * Updates every outdated app, one at a time, and returns what went through and what failed.
   */
  async run(): Promise<AutoUpdateReport> {
    const { hangar, docker, notifications } = await this.createServices();

    // Asked here rather than read off the last `CheckImageVersion` result: that report is up to
    // four hours old, and pulling for an app already up to date is a recreate for nothing.
    const { outdated } = await docker.checkUpdates(hangar.store.config.registryThrottling());
    const running = await UpdateOutdatedApps.running(docker);

    // Only what runs: `up -d` would start a stopped app. And never an app `hangar.yml` keeps to manual
    // updates; its badge stays on the Apps page.
    const projects = [...outdated].filter(
      project => running.has(project) && hangar.store.config.entry(project)?.update !== false,
    );

    const updated: string[] = [];
    const failed: string[] = [];

    // Sequential: each app is a full pull and recreate, and the daemon is the same one serving
    // everything else on the host.
    for (const project of projects) {
      try {
        await hangar.store.composeApp(project, ["up", "-d", "--pull", "always"]);
        updated.push(project);
      } catch (error) {
        failed.push(project);
        logger.error("Auto-update failed", { error, project });
      }
    }

    logger.info(`Auto-update: ${updated.length} app(s) updated, ${failed.length} failed`);

    // One notification for the run, not one per app: this happens while nobody is watching.
    // Nothing to tell the web server either: this process cannot reach its cache, but the daemon
    // reports every recreated container to it, and the badge clears with the reload that follows.
    if (updated.length > 0 || failed.length > 0) {
      await notifications.notify({
        level: failed.length > 0 ? "error" : "success",
        title: "Mise à jour automatique",
        description:
          `${updated.length} application${updated.length > 1 ? "s ont été mises" : " a été mise"} à jour.` +
          (failed.length > 0 ? ` Échec pour : ${failed.join(", ")}.` : ""),
        href: "/apps",
        dedupeKey: "auto-update",
      });
    }

    return { ranAt: new Date().toISOString(), updated, failed };
  }

  /** The projects with at least one running container. */
  private static async running(docker: JobServices["docker"]) {
    const { projects } = await docker.projects();

    return new Set(projects.filter(project => project.runningCount > 0).map(project => project.name));
  }
}
