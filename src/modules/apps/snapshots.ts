import { all, map } from "#libs/cache";
import { Docker, type ComposeProjectsSnapshot, type ComposeProjectSummary } from "#libs/docker";
import { docker } from "#libs/docker/server";
import type { Category } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { imageCheckReport } from "#libs/jobs/server";

/** What /apps shows: the Docker snapshot, once the store has added what only it knows, and the apps not installed. */
export class AppsSnapshot {
  /** What Docker would say of an app that is not installed: nothing runs, nothing to count. */
  private static readonly Uninstalled = {
    status: "stopped",
    serviceCount: 0,
    runningCount: 0,
    unhealthyCount: 0,
    containerIds: [],
    updateAvailable: false,
    installed: false,
  } as const satisfies Partial<ComposeProjectSummary>;

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
   * The store apps that are not installed, one row each with no Docker state. Read from the store alone, so they
   * stay listed, and installable, while the daemon is down.
   */
  static uninstalled(): ComposeProjectSummary[] {
    const categories = hangar.store.config.categories();

    return hangar.store.uninstalledApps().map(app => ({
      ...AppsSnapshot.Uninstalled,
      name: app.id,
      icon: app.icon,
      category: AppsSnapshot.category(categories, app.id),
    }));
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
        installed: true,
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
