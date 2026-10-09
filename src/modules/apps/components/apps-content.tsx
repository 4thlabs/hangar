import type { ReactNode } from "react";
import { map, recover } from "#libs/cache";
import { logger } from "#libs/logs";
import { AppsOverview } from "#modules/apps/components/apps-overview.tsx";
import type { AppsSearch } from "#modules/apps/search-codec.ts";
import { AppsSnapshot } from "#modules/apps/snapshots.ts";

/**
 * Docker half of /apps, a child so a cold read suspends inside the boundary, not in the page's own route. Returns
 * the cached read rather than awaiting it: warm, React renders it at once. Errors render in AppsOverview (with
 * retry), not the route error boundary.
 */
export function AppsContent({ search }: { search: AppsSearch }): Promise<ReactNode> {
  const overview = map(AppsSnapshot.load(), snapshot => (
    <AppsOverview snapshot={snapshot} error={null} search={search} />
  ));

  return recover(overview, (error: unknown) => {
    logger.error("Failed to render Docker Compose projects", { error });

    return (
      <AppsOverview
        snapshot={null}
        error="Le daemon Docker est indisponible. Vérifiez le socket et ses permissions."
        search={search}
      />
    );
  });
}
