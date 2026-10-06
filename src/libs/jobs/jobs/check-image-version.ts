import { Job } from "sidequest";
import type { ImageUpdateReport } from "#libs/docker";
import { logger } from "#libs/logs";
import type { CreateJobServices } from "../services.ts";
import { createWorkerServices } from "../worker.ts";

/**
 * Asks the registry what it serves for every reference the installed apps run. The returned report
 * is stored as the job's `result`, which the Apps pages read back and compare with what runs then.
 */
export class CheckImageVersion extends Job {
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
   * Asks the registry about every installed image and returns the report Sidequest stores.
   */
  async run(): Promise<ImageUpdateReport> {
    const { hangar, docker, notifications } = await this.createServices();
    const { remotes, outdated } = await docker.checkUpdates(hangar.store.config.registryThrottling());

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
