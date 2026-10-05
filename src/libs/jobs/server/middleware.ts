import { Sidequest } from "sidequest";
import { CheckImageVersion } from "../jobs/check-image-version.ts";
import { UpdateOutdatedApps } from "../jobs/update-outdated-apps.ts";
import { MiddlewareHandler } from "hono/types";
import { env } from "#libs/env";

/**
 * Starts Sidequest and schedules Hangar's jobs, once, after the first request the server answers.
 */
export class SidequestBoot {
  /**
   * Every four hours, not the every-10s of the stub: each check makes the daemon hit the registry's
   * manifest endpoint, which counts against Docker Hub's anonymous per-IP limit. Off the hour: at
   * :00 every other cron on the internet polls the registries too, and every run there came back
   * rate limited or timed out, while the same check a few minutes later went through.
   */
  private static readonly ImageCheckSchedule = "17 */4 * * *";

  /**
   * Nightly, at an hour nobody is using the stacks: each app it touches is a pull and a recreate,
   * so the containers go down and back up. Off the hour and clear of the 04:17 check, for the same
   * rate-limit reason.
   */
  private static readonly UpdateSchedule = "47 4 * * *";

  /** Whether Sidequest is already started, so later requests go straight through. */
  private configured = false;

  /**
   * The middleware booting Sidequest behind the first request.
   */
  middleware(): MiddlewareHandler {
    return async (_c, next) => {
      await next();

      if (this.configured) return;

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

      // First launched
      await Sidequest.build(CheckImageVersion).enqueue();

      await Sidequest.build(UpdateOutdatedApps).schedule(SidequestBoot.UpdateSchedule);

      this.configured = true;
    };
  }
}

/** The one boot the server runs. */
export const sidequestBoot = new SidequestBoot();
