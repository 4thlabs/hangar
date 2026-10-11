import type { ReactNode } from "react";
import { map, recover } from "#libs/cache";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ClusterOverview } from "#modules/cluster/components/cluster-overview.tsx";

/**
 * The stacks Hangar can deploy again and remove: named after an installed store app that ships a
 * compose.swarm.yml, whoever deployed them.
 */
function manageableStacks() {
  return [...hangar.store.apps].filter(app => app.installed && app.swarmReady).map(app => app.id);
}

/**
 * Docker half of /cluster, a child so a cold read suspends inside the boundary. Returns the cached read rather
 * than awaiting it, as `AppsContent` does. A manager that lost its quorum fails the read: that renders in
 * ClusterOverview, with retry.
 */
export function ClusterContent(): Promise<ReactNode> {
  const overview = map(swarm.cluster(), cluster => (
    <ClusterOverview cluster={cluster} error={null} manageableStacks={manageableStacks()} />
  ));

  return recover(overview, (error: unknown) => {
    logger.error("Failed to read the Swarm cluster", { error });

    return (
      <ClusterOverview
        cluster={null}
        manageableStacks={[]}
        error="Le daemon Docker ne répond pas pour le swarm. Vérifiez le socket, ou que le cluster a encore un leader."
      />
    );
  });
}
