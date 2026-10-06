import { Cache } from "#libs/cache";
import { Docker, type ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { imageCheckReport } from "#libs/jobs";

/**
 * Decorates the Docker snapshot with what only the store knows: the update badge, the icon and
 * the category. Pure, because {@link appsSnapshot} runs it on every read and every peek.
 */
function decorate(snapshot: ComposeProjectsSnapshot, outdated: ReadonlySet<string>): ComposeProjectsSnapshot {
  const categories = hangar.config.categories();
  // Nothing stops a stack from being listed twice: the first match wins, as it does for Arcane tags.
  // Only the name and colour travel to the client; the stack list would be dead weight on every row.
  const categoryOf = (stack: string) => {
    const found = categories.find(category => category.stacks.includes(stack));

    return found && { name: found.name, color: found.color };
  };

  return {
    projects: snapshot.projects.map(project => ({
      ...project,
      updateAvailable: outdated.has(project.name),
      icon: hangar.store.app(project.name)?.icon,
      category: categoryOf(project.name),
    })),
  };
}

/**
 * The apps running an image the last check found the registry has moved past.
 * Recomputed from both snapshots on every read, so an update clears the badge whoever ran it, with no invalidation.
 */
export const outdatedSnapshot = Cache.join(docker.runningImages, imageCheckReport.snapshot, Docker.outdated);

/** Everything /apps renders; the page and the warm loop share it, so they cannot disagree on what to warm. */
export const appsSnapshot = Cache.join(docker.projects, outdatedSnapshot, decorate);
