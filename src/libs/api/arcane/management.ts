import { Hangar, HangarError } from "#libs/hangar";
import { logger } from "#libs/logs";
import { getProjects, updateProjectTag } from "./client.ts";

/**
 * Arcane Tags synchronisation based on the hangar configuration
 *
 * @returns a process exit code of 0 on success.
 * @throws {HangarError} When projects cannot be read or one or more tags cannot be updated.
 */
export const syncTags = async (hangar: Hangar) => {
  const projects = await getProjects();

  if (!projects.success) {
    logger.error("Failed to grab projects", { detail: projects.detail });
    throw new HangarError("Failed to grab projects");
  }

  const categories = hangar.config.categories();
  const categoryNames = new Set(categories.map(category => category.name));
  const failures: string[] = [];

  for (const project of projects.data) {
    const category = categories.find(candidate => candidate.stacks.includes(project.dirName));

    if (category) {
      try {
        await updateProjectTag(project.id, category.name, category.color, true);
      } catch (error) {
        logger.error("Failed to attach tag", { error, project: project.dirName, tag: category.name });
        failures.push(`${project.dirName}: +${category.name}`);
      }
    } else {
      if (project.runningCount > 0) {
        logger.warn(`The project ${project.dirName} is running but not in any homelab category`);
      }

      const tagsToRemove = project.tags.filter(tag => categoryNames.has(tag.name));

      for (const tag of tagsToRemove) {
        try {
          await updateProjectTag(project.id, tag.name, "", false);
        } catch (error) {
          logger.error("Failed to detach tag", { error, project: project.dirName, tag: tag.name });
          failures.push(`${project.dirName}: -${tag.name}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new HangarError(`Failed to sync ${failures.length} tag(s): ${failures.join(", ")}`);
  }

  return 0;
};
