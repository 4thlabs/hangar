import { all, map } from "#libs/cache";
import { Docker, type ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import type { Category } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { imageCheckReport } from "#libs/jobs/server";

/** What /apps shows of the Docker snapshot, once the store has added what only it knows. */
export class AppsSnapshot {
  /**
   * Everything /apps renders.
   */
  static load(): Promise<ComposeProjectsSnapshot> {
    return map(all([docker.projects(), AppsSnapshot.outdated()]), ([snapshot, outdated]) =>
      AppsSnapshot.decorate(snapshot, outdated),
    );
  }

  /**
   * The apps running an image the last check found the registry has moved past.
   * Recomputed from both cached reads every time, so an update clears the badge whoever ran it, with no invalidation.
   */
  static outdated(): Promise<Set<string>> {
    return map(all([docker.runningImages(), imageCheckReport.remotes()]), ([running, remotes]) =>
      Docker.outdated(running, remotes),
    );
  }

  /**
   * Decorates the Docker snapshot with what only the store knows: the update badge, the icon and
   * the category. Pure, because {@link AppsSnapshot.load} runs it on every read.
   */
  private static decorate(snapshot: ComposeProjectsSnapshot, outdated: ReadonlySet<string>): ComposeProjectsSnapshot {
    const categories = hangar.store.config.categories();

    return {
      projects: snapshot.projects.map(project => ({
        ...project,
        updateAvailable: outdated.has(project.name),
        icon: hangar.store.app(project.name)?.icon,
        category: AppsSnapshot.category(categories, project.name),
      })),
    };
  }

  /**
   * The category a stack is filed under. Nothing stops a stack from being listed twice: the first match wins, as it
   * does for Arcane tags. Only the name and colour travel to the client; the stack list would be dead weight on
   * every row.
   */
  private static category(categories: readonly Category[], stack: string) {
    const found = categories.find(category => category.stacks.includes(stack));

    return found && { name: found.name, color: found.color };
  }
}
