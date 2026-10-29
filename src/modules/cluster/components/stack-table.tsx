"use client";

import { AppRowActions } from "#modules/apps/components/app-row-actions.tsx";
import { AppInstallation } from "#modules/apps/installation.ts";
import { ClusterStacks, type ClusterStack } from "#modules/cluster/cluster-stacks.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import type { StackSortColumn } from "#modules/cluster/search.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import type { SortState } from "#modules/common/table-sort.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type StackTableProps = {
  stacks: ClusterStack[];
  /** The stacks Hangar can deploy, which get a badge. */
  manageableStacks: readonly string[];
  sort: SortState<StackSortColumn>;
  onSort: (column: StackSortColumn) => void;
  onOpen: (stack: string) => void;
};

/**
 * The stacks of the swarm, one row each: health, replicas, and the nodes their tasks run on. A stack
 * running nowhere stays listed, so its sheet still tells why, and so does an installed app not deployed
 * yet, whose sheet deploys it. Its name opens the sheet. A store app that is not installed gets a row
 * when the user asks, to install it from there.
 */
export function StackTable({ stacks, manageableStacks, sort, onSort, onOpen }: StackTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead column="name" label="Stack" sort={sort} onSort={onSort} />
          <SortableHead column="health" label="Santé" sort={sort} onSort={onSort} />
          <SortableHead column="replicas" label="Réplicas" sort={sort} onSort={onSort} />
          <SortableHead column="nodes" label="Nœuds" sort={sort} onSort={onSort} />
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stacks.map(stack => (
          <TableRow
            key={stack.name}
            className={AppInstallation.isInstalled(stack) ? undefined : "text-muted-foreground"}
          >
            <TableCell className="font-medium">
              <StackName stack={stack} manageable={manageableStacks.includes(stack.name)} onOpen={onOpen} />
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <span className={ClusterLabels.HealthClass[stack.health]} aria-hidden>
                  {ClusterLabels.HealthSymbol[stack.health]}
                </span>
                {ClusterLabels.HealthShort[stack.health]}
              </span>
            </TableCell>
            <TableCell className="tabular-nums">
              {ClusterStacks.isDeployed(stack) ? `${stack.running}/${stack.desired}` : "—"}
            </TableCell>
            <TableCell>
              <StackPlacement stack={stack} />
            </TableCell>
            <TableCell>
              <StackActions stack={stack} manageable={manageableStacks.includes(stack.name)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type StackRowProps = {
  stack: ClusterStack;
  /** Whether it is an installed store app Hangar deploys */
  manageable: boolean;
};

/**
 * The stack's name, which opens its sheet, and where it comes from. A store app that is not installed has no sheet:
 * it cannot be deployed until it is.
 */
function StackName({ stack, manageable, onOpen }: StackRowProps & { onOpen: (stack: string) => void }) {
  if (!AppInstallation.isInstalled(stack)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {stack.name}
        <Badge variant="outline">Non installée</Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="cursor-pointer hover:underline" onClick={() => onOpen(stack.name)}>
        {stack.name}
      </button>
      {manageable && <Badge variant="outline">Hangar</Badge>}
    </div>
  );
}

/** Install, edit or uninstall a store app; a stack deployed by something else gets nothing. */
function StackActions({ stack, manageable }: StackRowProps) {
  const installed = AppInstallation.isInstalled(stack);

  if (installed && !manageable) {
    return null;
  }

  return <AppRowActions app={stack.name} installed={installed} />;
}

/** The nodes a stack's tasks run on, or why there are none. */
function StackPlacement({ stack }: { stack: ClusterStack }) {
  if (!ClusterStacks.isDeployed(stack)) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (stack.placement.length === 0) {
    return <span className="text-muted-foreground">aucune tâche</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {stack.placement.map(place => (
        <Badge key={place.nodeId} variant="secondary">
          {place.hostname} · {place.tasks}
        </Badge>
      ))}
    </div>
  );
}
