import { Sidequest } from "sidequest";
import { CheckImageVersion } from "../jobs/check-image-version.ts";
import { UpdateOutdatedApps } from "../jobs/update-outdated-apps.ts";
import { MiddlewareHandler } from "hono/types";

let configured: boolean = false;

export const sidequestBoot = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();

    if (configured) return;

    await Sidequest.configure({
      backend: {
        driver: "@sidequest/sqlite-backend",
        config: process.env.HANGAR_DB_HOST,
      },
      queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
      // Jobs come from `sidequest.jobs.js`, not from stack-trace guessing. See that file.
      manualJobResolution: true,
    });

    await Sidequest.start();

    // Hourly, not the every-10s of the stub: each check makes the daemon hit the registry's manifest
    // endpoint, which counts against Docker Hub's anonymous per-IP limit.
    await Sidequest.build(CheckImageVersion).schedule("0 */4 * * *");

    // First launched
    await Sidequest.build(CheckImageVersion).enqueue();

    // Nightly, at an hour nobody is using the stacks: each app it touches is a pull and a
    // recreate, so the containers go down and back up.
    await Sidequest.build(UpdateOutdatedApps).schedule("0 4 * * *");

    configured = true;
  };
};
