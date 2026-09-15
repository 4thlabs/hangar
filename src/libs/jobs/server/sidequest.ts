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

//await Sidequest.build(CheckImageVersion).schedule("*/10 * * * * *");