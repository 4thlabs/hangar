import { Suspense } from "react";
import type { PageProps } from "waku/router";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { PageSpinner } from "#app/components/common/page-spinner.tsx";
import type { AppsSearch } from "#app/search-codecs.ts";
import { appsSearchCodec } from "#app/search-codecs.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { outdatedProjects, peekOutdatedProjects } from "#libs/jobs";
import { logger } from "#libs/logs";

/**
 * Decorates the Docker snapshot with what only the store knows: the update badge, the icon and
 * the category. Pure, so both the warm and the cold path below build the same rows.
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
 * The Docker half of the page, kept as a child so the `await` happens inside the boundary below
 * rather than in the page itself — an async page component suspends its own route, which paints
 * nothing at all until the daemon answers.
 *
 * Errors are caught and rendered, not rethrown: `AppsOverview` already knows how to show one
 * next to a Réessayer button, and the route error boundary would take the whole page down.
 */
async function AppsContent({ search }: { search: AppsSearch }) {
  let snapshot: ComposeProjectsSnapshot | null = null;
  let error: string | null = null;

  try {
    const [projects, outdated] = await Promise.all([docker.listProjects(), outdatedProjects()]);

    snapshot = decorate(projects, outdated);
  } catch (failure) {
    logger.error("Failed to render Docker Compose projects", { error: failure });
    error = "Le daemon Docker est indisponible. Vérifiez le socket et ses permissions.";
  }

  return <AppsOverview snapshot={snapshot} error={error} search={search} />;
}

export default function AppsPage({ search }: PageProps<"/apps">) {
  // Read both without awaiting; either being cold sends the page down the suspending path.
  const projects = docker.peekProjects();
  const outdated = peekOutdatedProjects();
  const warm = projects && outdated ? decorate(projects, outdated) : undefined;

  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>Apps | Hangar</title>
      {warm ? (
        // Both snapshots already in hand, so the list renders inline. Wrapping it in a boundary
        // anyway would put the spinner in the shell and stream the page in behind it, which is a
        // spinner shown for data the server never had to wait for.
        <AppsOverview snapshot={warm} error={null} search={search} />
      ) : (
        /* Keyed, because Waku renders the route slot unkeyed: the detail page has the same
           shape, so React would reuse this boundary and — a navigation being a transition —
           keep that page on screen rather than swap in the spinner. The key is constant: a
           search-param change must not remount the boundary and flash it. */
        <Suspense key="apps" fallback={<PageSpinner />}>
          <AppsContent search={search} />
        </Suspense>
      )}
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
