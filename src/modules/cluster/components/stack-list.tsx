import { ChevronRightIcon } from "lucide-react";
import type { SwarmStack } from "#libs/docker";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type StackListProps = {
  stacks: SwarmStack[];
  /** The stacks Hangar can redeploy, which get a badge. */
  manageableStacks: string[];
  onOpen: (stack: string) => void;
};

/**
 * Every stack of the swarm, once each: its health, its replicas, and the nodes its tasks run on. A stack
 * running nowhere stays listed, so its sheet still tells why.
 */
export function StackList({ stacks, manageableStacks, onOpen }: StackListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stacks</CardTitle>
      </CardHeader>
      <CardContent>
        {stacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune stack déployée.</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {stacks.map(stack => (
              <li key={stack.name}>
                <StackRow stack={stack} manageable={manageableStacks.includes(stack.name)} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type StackRowProps = {
  stack: SwarmStack;
  manageable: boolean;
  onOpen: (stack: string) => void;
};

/** One stack; the placement wraps under its name on a narrow screen. A click opens its sheet. */
function StackRow({ stack, manageable, onOpen }: StackRowProps) {
  return (
    <button
      type="button"
      className="-mx-2 flex w-[calc(100%+--spacing(4))] flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-left hover:bg-muted"
      onClick={() => onOpen(stack.name)}
    >
      <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
        <span
          className={ClusterLabels.HealthClass[stack.health]}
          title={ClusterLabels.Health[stack.health]}
          aria-hidden
        >
          {ClusterLabels.HealthSymbol[stack.health]}
        </span>
        <span className="sr-only">{ClusterLabels.Health[stack.health]}</span>
        <span className="truncate font-medium">{stack.name}</span>
        {manageable && <Badge variant="outline">Hangar</Badge>}
      </span>
      <span className="w-28 text-muted-foreground tabular-nums">{ClusterLabels.replicas(stack)}</span>
      <span className="flex flex-1 basis-48 flex-wrap items-center gap-1.5">
        {stack.placement.length === 0 ? (
          <span className="text-muted-foreground">aucune tâche</span>
        ) : (
          stack.placement.map(place => (
            <Badge key={place.nodeId} variant="secondary">
              {place.hostname} {place.tasks}
            </Badge>
          ))
        )}
      </span>
      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
    </button>
  );
}
