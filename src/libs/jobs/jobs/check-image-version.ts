import Dockerode from "dockerode";
import { Job } from "sidequest";
import type { ImageUpdateReport } from "#libs/docker";
import { Docker } from "#libs/docker";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { db } from "#libs/db";
import { Notifications } from "#libs/notifications";

/**
 * Asks every installed app's registry what it serves for the references they run.
 *
 * The returned report *is* the store: it lands in the job's `result` column, and the Apps pages
 * read the newest completed run back out of it. It holds the registry's answers, not a verdict:
 * the pages compare them with what runs at the time they render, so an update needs no telling.
 */
export class CheckImageVersion extends Job {
  /**
   * Asks the registry about every installed image and returns the report Sidequest stores.
   */
  async run(): Promise<ImageUpdateReport> {
    // Its own client rather than `#libs/docker/server`: that module is `server-only`, and a job
    // is imported by a plain Node process. Same two arguments the web server passes.
    const docker = new Docker(new Dockerode(), hangar.store);
    const remotes = await docker.remoteDigests(hangar.store.config.registryThrottling());
    const outdated = Docker.outdated(await docker.runningImages.read(), remotes).size;

    // In the message, not in metadata: the log format only ever prints `message` and `error`.
    logger.info(`Checked ${Object.keys(remotes).length} image references for updates: ${outdated} app(s) outdated`);

    // Every four hours, for whoever is signed up. The dedupe key means the run rewrites its own
    // notification instead of stacking six identical ones a day.
    if (outdated > 0) {
      // Its own instance rather than `#libs/notifications/server`: that module is `server-only`,
      // and a job is imported by a plain Node process. Same reason as the Docker client above.
      await new Notifications(db).notify({
        level: "info",
        title: "Mises à jour disponibles",
        description: `${outdated} application${outdated > 1 ? "s ont" : " a"} une image plus récente en registre.`,
        href: "/apps",
        dedupeKey: "image-updates",
      });
    }

    return { checkedAt: new Date().toISOString(), remotes };
  }
}
