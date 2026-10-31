"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { SwarmCluster } from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";
import { ClusterStacks } from "#modules/cluster/cluster-stacks.ts";
import { ClusterEmpty } from "#modules/cluster/components/cluster-empty.tsx";
import { NodeCard } from "#modules/cluster/components/node-card.tsx";
import { StackFilters } from "#modules/cluster/components/stack-filters.tsx";
import { StackSheet } from "#modules/cluster/components/stack-sheet.tsx";
import { StackTable } from "#modules/cluster/components/stack-table.tsx";
import { SwarmSetup } from "#modules/cluster/components/swarm-setup.tsx";
import { TokensDialog } from "#modules/cluster/components/tokens-dialog.tsx";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import type { ClusterSearchState, StackSortColumn } from "#modules/cluster/search.ts";
import { StackFilter } from "#modules/cluster/stack-filter.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useRouteRefresh } from "#modules/common/hooks/use-route-refresh.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { TableSort } from "#modules/common/table-sort.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** The swarm as read, or why it could not be, and how the stack table is filtered and sorted. */
type ClusterOverviewProps = { search: ClusterSearchState } & (
  | {
      cluster: SwarmCluster;
      /** The installed store apps with a compose.swarm.yml: Hangar deploys them, and lists them until it has. */
      manageableStacks: string[];
    }
  | { error: string }
);

export function ClusterOverview(props: ClusterOverviewProps) {
  const { refresh, isRefreshing } = useRouteRefresh();
  const { t } = useTranslation(ClusterMessages);
  const [openStack, setOpenStack] = useState<string | null>(null);
  const cluster = "cluster" in props ? props.cluster : null;
  const manager = cluster?.state === "manager" ? cluster : null;
  const manageableStacks = "manageableStacks" in props ? props.manageableStacks : [];
  const stacks = manager ? ClusterStacks.list(manager.stacks, manageableStacks) : [];
  const openRow = stacks.find(stack => stack.name === openStack);
  const setSearch = useSetSearch_UNSTABLE({ from: "/cluster" });
  const onSort = (column: StackSortColumn) => void setSearch({ sort: TableSort.next(props.search.sort, column) });

  return (
    <>
      {/* The pace of the cache: Docker emits no event for a task, so only time moves the task counts. */}
      <AutoReload seconds={SwarmRules.RefreshMs / 1_000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {manager ? ClusterLabels.summary(manager, t) : t("description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {manager && <TokensDialog />}
          <PendingButton
            type="button"
            variant="outline"
            pending={isRefreshing}
            pendingLabel={t("refresh")}
            icon={<RefreshCwIcon data-icon="inline-start" />}
            onClick={() => void refresh()}
          >
            {t("refresh")}
          </PendingButton>
        </div>
      </div>

      {"error" in props && (
        <Alert variant="destructive">
          <AlertTitle>{t("unavailableTitle")}</AlertTitle>
          <AlertDescription>{props.error}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              {t("retry")}
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
            <h2 className="text-lg font-semibold">{t("stacks")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StackFilters nodes={manager.nodes} counts={StackFilter.counts(stacks, manageableStacks)} />
            </div>
          </div>
          <StackTableOrEmpty
            stacks={StackFilter.apply(stacks, props.search, manageableStacks)}
            total={stacks.length}
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
        deployed={openRow !== undefined && ClusterStacks.isDeployed(openRow)}
        onClose={() => setOpenStack(null)}
      />
    </>
  );
}

/** The stack table, or why it has no row: no stack at all, or none the filters keep. */
function StackTableOrEmpty({ total, ...table }: ComponentProps<typeof StackTable> & { total: number }) {
  const { t } = useTranslation(ClusterMessages);

  if (table.stacks.length > 0) {
    return <StackTable {...table} />;
  }

  return <p className="text-sm text-muted-foreground">{total === 0 ? t("noStacks") : t("noMatchingStacks")}</p>;
}
