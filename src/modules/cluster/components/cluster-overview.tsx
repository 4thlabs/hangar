"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { SwarmCluster } from "#libs/docker";
import { plural } from "#modules/apps/format.ts";
import { ClusterEmpty } from "#modules/cluster/components/cluster-empty.tsx";
import { NodeCard } from "#modules/cluster/components/node-card.tsx";
import { StackSheet } from "#modules/cluster/components/stack-sheet.tsx";
import { SwarmSetup } from "#modules/cluster/components/swarm-setup.tsx";
import { TokensDialog } from "#modules/cluster/components/tokens-dialog.tsx";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** How many characters of the cluster id the page shows, as the `docker` CLI shortens ids. */
const SHORT_ID_LENGTH = 12;

/**
 * Tighter than /apps: Docker emits no event for a task, so only a reload moves the task counts. Matches the
 * cache's TTL for the cluster.
 */
const RELOAD_SECONDS = 10;

type ClusterOverviewProps = {
  cluster: SwarmCluster | null;
  error: string | null;
  /** The stacks named after an installed store app with a compose.swarm.yml: Hangar can redeploy them. */
  manageableStacks: string[];
};

/** The one line under the title: which cluster, how big, how much it can lose. */
function clusterSummary(cluster: Extract<SwarmCluster, { state: "manager" }>) {
  const tolerance = `tolère ${plural(cluster.faultTolerance, "panne")}`;

  return [
    cluster.clusterId.slice(0, SHORT_ID_LENGTH),
    plural(cluster.nodes.length, "nœud"),
    `${plural(cluster.managers, "manager")} (${tolerance})`,
  ].join(" · ");
}

export function ClusterOverview({ cluster, error, manageableStacks }: ClusterOverviewProps) {
  const router = useRouter();
  const [isRefreshing, setRefreshing] = useState(false);
  const [openStack, setOpenStack] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      await router.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <AutoReload seconds={RELOAD_SECONDS} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cluster</h1>
          <p className="text-sm text-muted-foreground">
            {cluster?.state === "manager" ? clusterSummary(cluster) : "Le cluster Swarm dont ce serveur fait partie."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cluster?.state === "manager" && <TokensDialog />}
          <Button type="button" variant="outline" disabled={isRefreshing} onClick={() => void refresh()}>
            {isRefreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Swarm indisponible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </AlertAction>
        </Alert>
      )}

      {cluster?.state === "manager" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cluster.nodes.map(node => (
            <NodeCard key={node.id} cluster={cluster} node={node} onOpenStack={setOpenStack} />
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
