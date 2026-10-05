import { AppsOverview } from "#modules/apps/components/apps-overview.tsx";
import type { AppsSearch } from "#modules/apps/search-codec.ts";
import { appsSnapshot } from "#modules/apps/snapshots.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { logger } from "#libs/logs";

type AppsContentProps = {
  search: AppsSearch;
  /** The snapshot the page peeked, when it was warm. */
  ready: { data: ComposeProjectsSnapshot } | undefined;
};

/**
 * The Docker half of `/apps`, kept as a child so the `await` happens inside the boundary rather
 * than in the page itself — an async page component suspends its own route, which paints nothing
 * at all until the daemon answers.
 *
 * Renders synchronously when the snapshot is warm, and only then does `<Warm>` above leave the
 * boundary out. Both paths render the same rows because both come from `appsSnapshot`.
 *
 * Errors are caught and rendered, not rethrown: `AppsOverview` already knows how to show one
 * next to a Réessayer button, and the route error boundary would take the whole page down.
 */
export function AppsContent({ search, ready }: AppsContentProps) {
  if (ready) return <AppsOverview snapshot={ready.data} error={null} search={search} />;

  return <ColdAppsContent search={search} />;
}

/** The cold path: waits for the daemon, inside the boundary. */
async function ColdAppsContent({ search }: { search: AppsSearch }) {
  try {
    return <AppsOverview snapshot={await appsSnapshot.read()} error={null} search={search} />;
  } catch (error) {
    logger.error("Failed to render Docker Compose projects", { error });

    return (
      <AppsOverview
        snapshot={null}
        error="Le daemon Docker est indisponible. Vérifiez le socket et ses permissions."
        search={search}
      />
    );
  }
}
