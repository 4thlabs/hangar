import { join } from "#libs/cache";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { outdatedSnapshot } from "#libs/jobs";

/**
 * Decorates the Docker snapshot with what only the store knows: the update badge, the icon and
 * the category. Pure, because {@link appsSnapshot} runs it on every read and every peek.
 */
function decorate(projects: ComposeProjectsSnapshot, outdated: ReadonlySet<string>): ComposeProjectsSnapshot {
  const categories = hangar.config.categories();
  // Nothing stops a stack from being listed twice: the first match wins, as it does for Arcane tags.
  // Only the name and colour travel to the client; the stack list would be dead weight on every row.
  const categoryOf = (stack: string) => {
    const found = categories.find(category => category.stacks.includes(stack));

    return found && { name: found.name, color: found.color };
  };

  return {
    projects: projects.projects.map(p => ({
      ...p,
      updateAvailable: outdated.has(p.name),
      icon: hangar.store.app(p.name)?.icon,
      category: categoryOf(p.name),
    })),
  };
}

/**
 * Everything `/apps` renders, as one snapshot.
 *
 * It exists so the page and the warm loop cannot disagree about what that is. They used to name
 * their ingredients separately, and drifted: the loop warmed the Docker sweep and the widgets,
 * while the page also needs the image-update report, which was only ever warmed as a side effect
 * of the `docker-general-stats` widget happening to load it. Take that widget out of `hangar.yml`
 * and `/apps` quietly went back to painting a spinner. Now there is one object to warm and to
 * render from, so removing a widget cannot slow down an unrelated page.
 */
export const appsSnapshot = join(docker.projects, outdatedSnapshot, decorate);
