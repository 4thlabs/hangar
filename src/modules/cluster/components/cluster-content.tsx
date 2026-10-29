import type { ReactNode } from "react";
import { map, recover } from "#libs/cache";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ClusterOverview } from "#modules/cluster/components/cluster-overview.tsx";
import type { ClusterSearchState } from "#modules/cluster/search.ts";

/**
 * Docker half of /cluster, a child so a cold read suspends inside the boundary. Returns the cached read rather
 * than awaiting it, as `AppsContent` does. A manager that lost its quorum fails the read: that renders in
 * ClusterOverview, with retry.
 */
type ClusterContentProps = {
  search: ClusterSearchState;
  /** Whether the store apps that are not installed are listed, as the user last chose. */
  showUninstalled: boolean;
};

export function ClusterContent({ search, showUninstalled }: ClusterContentProps): Promise<ReactNode> {
  const uninstalledStacks = hangar.store
    .uninstalledApps()
    .filter(app => app.swarmReady)
    .map(app => app.id);

  const overview = map(swarm.cluster(), cluster => (
    <ClusterOverview
      cluster={cluster}
      manageableStacks={hangar.store.manageableStacks()}
      uninstalledStacks={uninstalledStacks}
      search={search}
      showUninstalled={showUninstalled}
    />
  ));

  return recover(overview, (error: unknown) => {
    logger.error("Failed to read the Swarm cluster", { error });

    return (
      <ClusterOverview
        search={search}
        showUninstalled={showUninstalled}
        error="Le daemon Docker ne répond pas pour le swarm. Vérifiez le socket, ou que le cluster a encore un leader."
      />
    );
  });
}
