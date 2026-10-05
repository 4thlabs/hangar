import { Cache } from "#libs/cache";
import { Docker, type ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { imageCheckReport } from "#libs/jobs";

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
 * The apps running an image the last check found the registry has moved past.
 *
 * Recomputed on every read from two snapshots that each refresh on their own clock: the check's
 * stored registry digests, and the digests of what runs now. An update therefore clears the
 * badge as soon as the reloaded containers show it, whoever ran it — this page, the nightly job or
 * a shell — with nothing to invalidate.
 */
export const outdatedSnapshot = Cache.join(docker.runningImages, imageCheckReport.snapshot, Docker.outdated);

/**
 * Everything `/apps` renders, as one snapshot.
 *
 * It exists so the page and the warm loop cannot disagree about what that is. They used to name
 * their ingredients separately, and drifted: the loop warmed the Docker containers and the widgets,
 * while the page also needs the image-update report, which was only ever warmed as a side effect
 * of the `docker-general-stats` widget happening to load it. Take that widget out of `hangar.yml`
 * and `/apps` quietly went back to painting a spinner. Now there is one object to warm and to
 * render from, so removing a widget cannot slow down an unrelated page.
 */
export const appsSnapshot = Cache.join(docker.projects, outdatedSnapshot, decorate);
