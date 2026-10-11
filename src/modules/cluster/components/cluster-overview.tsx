"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { SwarmCluster } from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import { ClusterEmpty } from "#modules/cluster/components/cluster-empty.tsx";
import { NodeCard } from "#modules/cluster/components/node-card.tsx";
import { StackFilters } from "#modules/cluster/components/stack-filters.tsx";
import { StackSheet } from "#modules/cluster/components/stack-sheet.tsx";
import { StackTable } from "#modules/cluster/components/stack-table.tsx";
import { SwarmSetup } from "#modules/cluster/components/swarm-setup.tsx";
import { TokensDialog } from "#modules/cluster/components/tokens-dialog.tsx";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import type { ClusterSearchState, StackSortColumn } from "#modules/cluster/search.ts";
import { StackFilter } from "#modules/cluster/stack-filter.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useRouteRefresh } from "#modules/common/hooks/use-route-refresh.ts";
import { TableSort } from "#modules/common/table-sort.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** The swarm as read, or why it could not be, and how the stack table is filtered and sorted. */
type ClusterOverviewProps = { search: ClusterSearchState } & (
  | {
      cluster: SwarmCluster;
      /** The stacks named after an installed store app with a compose.swarm.yml: Hangar can redeploy them. */
      manageableStacks: string[];
    }
  | { error: string }
);

export function ClusterOverview(props: ClusterOverviewProps) {
  const { refresh, isRefreshing } = useRouteRefresh();
  const [openStack, setOpenStack] = useState<string | null>(null);
  const cluster = "cluster" in props ? props.cluster : null;
  const manager = cluster?.state === "manager" ? cluster : null;
  const manageableStacks = "manageableStacks" in props ? props.manageableStacks : [];
  const setSearch = useSetSearch_UNSTABLE({ from: "/cluster" });
  const onSort = (column: StackSortColumn) => void setSearch({ sort: TableSort.next(props.search.sort, column) });

  return (
    <>
      {/* The pace of the cache: Docker emits no event for a task, so only time moves the task counts. */}
      <AutoReload seconds={SwarmRules.RefreshMs / 1_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cluster</h1>
          <p className="text-sm text-muted-foreground">
            {manager ? ClusterLabels.summary(manager) : "Le cluster Swarm dont ce serveur fait partie."}
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
            <NodeCard key={node.id} cluster={manager} node={node} />
          ))}
        </div>
      )}

      {manager && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Stacks</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StackFilters nodes={manager.nodes} counts={StackFilter.counts(manager.stacks, manageableStacks)} />
            </div>
          </div>
          <StackTableOrEmpty
            stacks={StackFilter.apply(manager.stacks, props.search, manageableStacks)}
            total={manager.stacks.length}
            manageableStacks={manageableStacks}
            sort={props.search.sort}
            onSort={onSort}
            onOpen={setOpenStack}
          />
        </section>
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

/** The stack table, or why it has no row: no stack at all, or none the filters keep. */
function StackTableOrEmpty({ total, ...table }: ComponentProps<typeof StackTable> & { total: number }) {
  if (table.stacks.length > 0) {
    return <StackTable {...table} />;
  }

  return (
    <p className="text-sm text-muted-foreground">
      {total === 0 ? "Aucune stack déployée." : "Aucune stack ne correspond à ces filtres."}
    </p>
  );
}
