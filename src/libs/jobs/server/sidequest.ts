import { Sidequest } from "sidequest";
import { CheckImageVersion } from "../jobs/check-image-version.ts";

await Sidequest.configure({
  backend: {
    driver: "@sidequest/sqlite-backend",
    config: process.env.HANGAR_DB_HOST,
  },
  queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
});

await Sidequest.start();

// Hourly, not the every-10s of the stub: each check makes the daemon hit the registry's manifest
// endpoint, which counts against Docker Hub's anonymous per-IP limit.
await Sidequest.build(CheckImageVersion).schedule("0 * * * *");

// Once at boot too, so a fresh install shows update badges without waiting for the hour.
await Sidequest.build(CheckImageVersion).enqueue();
