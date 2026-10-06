import { AppsOverview } from "#modules/apps/components/apps-overview.tsx";
import type { AppsSearch } from "#modules/apps/search-codec.ts";
import { appsSnapshot } from "#modules/apps/snapshots.ts";
import { renderSnapshot } from "#modules/common/components/render-snapshot.ts";
import { logger } from "#libs/logs";

/**
 * Docker half of /apps, a child so the `await` happens inside the boundary, not in the page's own route.
 * Errors render in AppsOverview (with retry), not the route error boundary.
 */
export function AppsContent({ search }: { search: AppsSearch }) {
  return renderSnapshot(
    appsSnapshot,
    snapshot => <AppsOverview snapshot={snapshot} error={null} search={search} />,
    (error: unknown) => {
      logger.error("Failed to render Docker Compose projects", { error });

      return (
        <AppsOverview
          snapshot={null}
          error="Le daemon Docker est indisponible. Vérifiez le socket et ses permissions."
          search={search}
        />
      );
    },
  );
}
