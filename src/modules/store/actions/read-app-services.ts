"use server";

import * as z from "zod";
import { sessions } from "#libs/auth/server";
import { DockerNotFoundError } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import type { ProjectServices } from "#modules/apps/project-services.ts";

/**
 * An app's services as Docker sees them, for the editor to draw beside its files. Read apart from the page, so a
 * slow or absent daemon never holds up the files.
 */
export const readAppServices = async (id: string): Promise<ProjectServices> => {
  await sessions.require();

  const parsed = z.string().safeParse(id);

  // Only an installed app runs: the daemon has nothing to tell about another.
  if (!parsed.success || !hangar.store.app(parsed.data)?.installed) {
    return { state: "absent" };
  }

  try {
    const detail = await docker.projectDetail(parsed.data);

    // An installed app taken down, or never started, reads as a stopped project without services.
    return detail.services.length > 0 ? { state: "loaded", detail } : { state: "absent" };
  } catch (error) {
    if (error instanceof DockerNotFoundError) {
      return { state: "absent" };
    }

    logger.error("Failed to read the services of an app", { error, app: parsed.data });

    return { state: "unavailable" };
  }
};
