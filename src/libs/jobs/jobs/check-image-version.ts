import Dockerode from "dockerode";
import { Job } from "sidequest";
import type { ImageUpdateReport } from "#libs/docker/compose.ts";
import { Docker } from "#libs/docker/docker.ts";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";

/**
 * Asks every installed app's registry whether it serves something newer than what is running.
 *
 * The returned report *is* the store: it lands in the job's `result` column, and the Apps pages
 * read the newest completed run back out of it. Nothing else persists it.
 */
export class CheckImageVersion extends Job {
  async run(): Promise<ImageUpdateReport> {
    // Its own client rather than `#libs/docker/server`: that module is `server-only`, and a job
    // is imported by a plain Node process. Same two arguments the web server passes.
    const updates = await new Docker(new Dockerode(), hangar.store).imageUpdates();

    // In the message, not in metadata: the log format only ever prints `message` and `error`.
    const outdated = updates.filter(update => update.status === "outdated").length;
    logger.info(`Checked ${updates.length} app images for updates: ${outdated} outdated`);

    return { checkedAt: new Date().toISOString(), updates };
  }
}
