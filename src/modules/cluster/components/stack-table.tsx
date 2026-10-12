"use client";

import { ClusterStacks, type ClusterStack } from "#modules/cluster/cluster-stacks.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import type { StackSortColumn } from "#modules/cluster/search.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import type { SortState } from "#modules/common/table-sort.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

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
 * yet, whose sheet deploys it. Its name opens the sheet.
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {stacks.map(stack => (
          <TableRow key={stack.name}>
            <TableCell className="font-medium">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="cursor-pointer hover:underline" onClick={() => onOpen(stack.name)}>
                  {stack.name}
                </button>
                {manageableStacks.includes(stack.name) && <Badge variant="outline">Hangar</Badge>}
              </div>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
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
