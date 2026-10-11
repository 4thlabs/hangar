import type { ReactNode } from "react";
import { map, recover } from "#libs/cache";
import { swarm } from "#libs/docker/server";
import { logger } from "#libs/logs";
import { ClusterOverview } from "#modules/cluster/components/cluster-overview.tsx";

/**
 * Docker half of /cluster, a child so a cold read suspends inside the boundary. Returns the cached read rather
 * than awaiting it, as `AppsContent` does. A manager that lost its quorum fails the read: that renders in
 * ClusterOverview, with retry.
 */
export function ClusterContent(): Promise<ReactNode> {
  const overview = map(swarm.cluster(), cluster => <ClusterOverview cluster={cluster} error={null} />);

  return recover(overview, (error: unknown) => {
    logger.error("Failed to read the Swarm cluster", { error });

    return (
      <ClusterOverview
        cluster={null}
        error="Le daemon Docker ne répond pas pour le swarm. Vérifiez le socket, ou que le cluster a encore un leader."
      />
    );
  });
}
