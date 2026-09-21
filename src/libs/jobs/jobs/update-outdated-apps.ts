import Dockerode from "dockerode";
import { Job } from "sidequest";
import { Docker } from "#libs/docker";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { db } from "#libs/db";
import { Notifications } from "#libs/notifications";

/** What one auto-update run did, kept in the job's `result` column for the Jobs settings table. */
export type AutoUpdateReport = { ranAt: string; updated: string[]; failed: string[] };

/**
 * Pulls and recreates every installed app whose registry serves something newer.

 * Runs nightly on its own schedule, and by hand from Settings > JOBS.
 */
export class UpdateOutdatedApps extends Job {
  async run(): Promise<AutoUpdateReport> {
    // Its own client rather than `#libs/docker/server`: that module is `server-only`, and a job
    // is imported by a plain Node process. Same two arguments the web server passes.
    const docker = new Docker(new Dockerode(), hangar.store);

    // Asked here rather than read off the last `CheckImageVersion` result: that report is up to
    // four hours old, and pulling for an app already up to date is a recreate for nothing.
    const updates = await docker.imageUpdates();
    const projects = [...new Set(updates.filter(update => update.status === "outdated").map(u => u.project))];

    const updated: string[] = [];
    const failed: string[] = [];

    // Sequential: each app is a full pull and recreate, and the daemon is the same one serving
    // everything else on the host.
    for (const project of projects) {
      try {
        await hangar.store.compose(project, ["up", "-d", "--pull", "always"]);
        updated.push(project);
      } catch (error) {
        failed.push(project);
        logger.error("Auto-update failed", { error, project });
      }
    }

    logger.info(`Auto-update: ${updated.length} app(s) updated, ${failed.length} failed`);

    // One notification for the run, not one per app: this happens while nobody is watching.
    // ponytail: no `docker.invalidate()` — that instance is `server-only` and out of reach here,
    // so an Apps page open across the run shows the old state until its snapshot expires (60s).
    if (updated.length > 0 || failed.length > 0) {
      await new Notifications(db).notify({
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
}
