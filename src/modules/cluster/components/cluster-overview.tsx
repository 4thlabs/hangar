"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { SwarmCluster, SwarmManagerView } from "#libs/docker";
import { faultTolerance, SwarmRefreshMs } from "#libs/docker/swarm-rules";
import { plural } from "#modules/apps/format.ts";
import { ClusterEmpty } from "#modules/cluster/components/cluster-empty.tsx";
import { NodeCard } from "#modules/cluster/components/node-card.tsx";
import { StackSheet } from "#modules/cluster/components/stack-sheet.tsx";
import { SwarmSetup } from "#modules/cluster/components/swarm-setup.tsx";
import { TokensDialog } from "#modules/cluster/components/tokens-dialog.tsx";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useRouteRefresh } from "#modules/common/hooks/use-route-refresh.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** How many characters of the cluster id the page shows, as the `docker` CLI shortens ids. */
const SHORT_ID_LENGTH = 12;

/** The swarm as read, or why it could not be. */
type ClusterOverviewProps =
  | {
      cluster: SwarmCluster;
      /** The stacks named after an installed store app with a compose.swarm.yml: Hangar can redeploy them. */
      manageableStacks: string[];
    }
  | { error: string };

/** The one line under the title: which cluster, how big, how much it can lose. */
function clusterSummary(cluster: SwarmManagerView) {
  const tolerance = `tolère ${plural(faultTolerance(cluster.managers), "panne")}`;

  return [
    cluster.clusterId.slice(0, SHORT_ID_LENGTH),
    plural(cluster.nodes.length, "nœud"),
    `${plural(cluster.managers, "manager")} (${tolerance})`,
  ].join(" · ");
}

export function ClusterOverview(props: ClusterOverviewProps) {
  const { refresh, isRefreshing } = useRouteRefresh();
  const [openStack, setOpenStack] = useState<string | null>(null);
  const cluster = "cluster" in props ? props.cluster : null;
  const manager = cluster?.state === "manager" ? cluster : null;
  const manageableStacks = "manageableStacks" in props ? props.manageableStacks : [];

  return (
    <>
      {/* The pace of the cache: Docker emits no event for a task, so only time moves the task counts. */}
      <AutoReload seconds={SwarmRefreshMs / 1_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cluster</h1>
          <p className="text-sm text-muted-foreground">
            {manager ? clusterSummary(manager) : "Le cluster Swarm dont ce serveur fait partie."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manager && <TokensDialog />}
          <PendingButton
            type="button"
            variant="outline"
            pending={isRefreshing}
            pendingLabel="Actualiser"
            icon={<RefreshCwIcon data-icon="inline-start" />}
            onClick={() => void refresh()}
          >
            Actualiser
          </PendingButton>
        </div>
      </div>

      {"error" in props && (
        <Alert variant="destructive">
          <AlertTitle>Swarm indisponible</AlertTitle>
          <AlertDescription>{props.error}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </AlertAction>
        </Alert>
      )}

      {manager && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {manager.nodes.map(node => (
            <NodeCard key={node.id} cluster={manager} node={node} onOpenStack={setOpenStack} />
          ))}
        </div>
      )}

      {cluster && cluster.state !== "manager" && <ClusterEmpty cluster={cluster} />}
      {cluster?.state === "inactive" && <SwarmSetup />}
      <StackSheet
        stack={openStack}
        manageable={openStack !== null && manageableStacks.includes(openStack)}
        onClose={() => setOpenStack(null)}
      />
    </>
  );
}
