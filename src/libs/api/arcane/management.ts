import { Hangar } from "#libs/hangar";
import { logger } from "#libs/logs";
import { getProjects, updateProjectTag } from "./client.ts";

/**
 * Arcane Tags synchronisation based on the hangar configuration
 *
 * @returns a process exit code: 0 on success, 1 on failure.
 */
export const syncTags = async (hangar: Hangar) => {
  const projects = await getProjects();

  if (!projects.success) {
    logger.error({ detail: projects.detail }, "Failed to grab projects");
    return 1;
  }

  // Read the config once: categories() is a getter, not a cheap constant.
  const categories = hangar.config.categories();
  const stacks = categories.flatMap(category => category.stacks);

  for (const project of projects.data) {
    const isInHomelab = stacks.includes(project.dirName);

    if (isInHomelab) {
      // Adding category tag
      const category = categories.find(candidate => candidate.stacks.includes(project.dirName));

      // stacks is derived from categories, so this cannot miss -- but assert it
      // rather than reaching through a non-null assertion.
      if (!category) continue;

      try {
        await updateProjectTag(project.id, category.name, category.color, true);
      } catch (error) {
        logger.error({ error, project: project.dirName }, "Failed to update tag");
      }

      continue;
    }

    if (project.runningCount > 0) {
      logger.warn(`The project ${project.dirName} is running but not in any homelab category`);
    }

    // Removing category tag
    for (const tag of project.tags) {
      if (!categories.some(category => category.name === tag.name)) continue;

      try {
        await updateProjectTag(project.id, tag.name, "", false);
      } catch (error) {
        logger.error({ error, project: project.dirName, tag: tag.name }, "Failed to remove tag");
      }
    }
  }

  return 0;
};
