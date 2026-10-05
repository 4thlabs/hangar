import { Job } from "sidequest";
import type { ImageUpdateReport } from "#libs/docker";
import { logger } from "#libs/logs";
import { createServices } from "#libs/services";

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
    // `createServices()` rather than `#libs/services/server`: that module is `server-only`, and a
    // job is imported by a plain Node process.
    const { hangar, docker, notifications } = createServices();
    const { remotes, outdated } = await docker.outdatedNow(hangar.store.config.registryThrottling());

    // In the message, not in metadata: the log format only ever prints `message` and `error`.
    logger.info(
      `Checked ${Object.keys(remotes).length} image references for updates: ${outdated.size} app(s) outdated`,
    );

    // Every four hours, for whoever is signed up. The dedupe key means the run rewrites its own
    // notification instead of stacking six identical ones a day.
    if (outdated.size > 0) {
      await notifications.notify({
        level: "info",
        title: "Mises à jour disponibles",
        description: `${outdated.size} application${outdated.size > 1 ? "s ont" : " a"} une image plus récente en registre.`,
        href: "/apps",
        dedupeKey: "image-updates",
      });
    }

    return { checkedAt: new Date().toISOString(), remotes };
  }
}
