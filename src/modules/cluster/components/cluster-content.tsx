import type { ReactNode } from "react";
import { map, recover } from "#libs/cache";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ClusterOverview } from "#modules/cluster/components/cluster-overview.tsx";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import type { ClusterSearchState } from "#modules/cluster/search.ts";

/**
 * Docker half of /cluster, a child so a cold read suspends inside the boundary. Returns the cached read rather
 * than awaiting it, as `AppsContent` does. A manager that lost its quorum fails the read: that renders in
 * ClusterOverview, with retry.
 */
export function ClusterContent({ search }: { search: ClusterSearchState }): Promise<ReactNode> {
  const { t } = ServerTranslation.get(ClusterMessages);

  const overview = map(swarm.cluster(), cluster => (
    <ClusterOverview cluster={cluster} manageableStacks={hangar.store.manageableStacks()} search={search} />
  ));

  return recover(overview, (error: unknown) => {
    logger.error("Failed to read the Swarm cluster", { error });

    return <ClusterOverview search={search} error={t("daemonUnavailable")} />;
  });
}
