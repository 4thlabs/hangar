import { MiddlewareHandler } from "hono/types";
import { Sidequest } from "sidequest";
import { env } from "#libs/env";
import { CheckImageVersion } from "../jobs/check-image-version.ts";
import { UpdateOutdatedApps } from "../jobs/update-outdated-apps.ts";

/**
 * Starts Sidequest and schedules Hangar's jobs, once, after the first request the server answers.
 */
export class SidequestBoot {
  /**
   * Every four hours, off the hour: each check counts against Docker Hub's per-IP limit, and :00 is
   * when every other cron polls the registries too.
   */
  private static readonly ImageCheckSchedule = "17 */4 * * *";

  /** Nightly, when nobody uses the stacks (each update recreates containers), clear of the 04:17 check. */
  private static readonly UpdateSchedule = "47 4 * * *";

  /** Whether Sidequest is already started, so later requests go straight through. */
  private configured = false;

  /** The middleware booting Sidequest behind the first request. */
  middleware(): MiddlewareHandler {
    return async (_c, next) => {
      await next();

      if (this.configured) {
        return;
      }

      await Sidequest.configure({
        backend: {
          driver: "@sidequest/sqlite-backend",
          config: env.HANGAR_DB_HOST,
        },
        queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
        // Jobs come from `sidequest.jobs.js`, not from stack-trace guessing. See that file.
        manualJobResolution: true,
      });

      await Sidequest.start();

      await Sidequest.build(CheckImageVersion).schedule(SidequestBoot.ImageCheckSchedule);

      // Once at boot, without waiting for the first scheduled run.
      await Sidequest.build(CheckImageVersion).enqueue();

      await Sidequest.build(UpdateOutdatedApps).schedule(SidequestBoot.UpdateSchedule);

      this.configured = true;
    };
  }
}

/** The one boot the server runs. */
export const sidequestBoot = new SidequestBoot();
