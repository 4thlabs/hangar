"use client";

import type { SwarmStack } from "#libs/docker";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import type { StackSortColumn } from "#modules/cluster/search.ts";
import { SortableHead } from "#modules/common/components/sortable-head.tsx";
import type { SortState } from "#modules/common/table-sort.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type StackTableProps = {
  stacks: SwarmStack[];
  /** The stacks Hangar can redeploy, which get a badge. */
  manageableStacks: readonly string[];
  sort: SortState<StackSortColumn>;
  onSort: (column: StackSortColumn) => void;
  onOpen: (stack: string) => void;
};

/**
 * The stacks of the swarm, one row each: health, replicas, and the nodes their tasks run on. A stack
 * running nowhere stays listed, so its sheet still tells why. Its name opens the sheet.
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
              {stack.running}/{stack.desired}
            </TableCell>
            <TableCell>
              {stack.placement.length === 0 ? (
                <span className="text-muted-foreground">aucune tâche</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {stack.placement.map(place => (
                    <Badge key={place.nodeId} variant="secondary">
                      {place.hostname} · {place.tasks}
                    </Badge>
                  ))}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
