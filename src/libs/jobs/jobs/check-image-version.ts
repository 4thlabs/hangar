import { logger } from "#libs/logs";
import { Job } from "sidequest";
import { hangar } from "#libs/hangar/server"

export class CheckImageVersion extends Job {
  async run() {
    // Your job logic here
    return { processed: true, result: "toto" };
  }
}