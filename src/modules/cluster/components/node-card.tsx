import type { SwarmNode } from "#libs/docker";
import { formatBytes, plural } from "#modules/apps/format.ts";
import {
  availabilityLabel,
  availabilityVariant,
  healthClass,
  healthLabel,
  healthSymbol,
  nodeStatusLabel,
  nodeStatusVariant,
  roleLabel,
} from "#modules/cluster/status.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type NodeCardProps = {
  node: SwarmNode;
  isCurrent: boolean;
};

/** One node of the swarm: what it is, and the stacks with tasks running on it. */
export function NodeCard({ node, isCurrent }: NodeCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {node.hostname}
          {isCurrent && <span className="text-xs font-normal text-muted-foreground">★ ce nœud</span>}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={node.role === "worker" ? "outline" : "default"}>{roleLabel[node.role]}</Badge>
          <Badge variant={nodeStatusVariant(node.status)}>{nodeStatusLabel[node.status]}</Badge>
          <Badge variant={availabilityVariant(node.availability)}>{availabilityLabel[node.availability]}</Badge>
        </div>
        <CardDescription>
          {node.cpus} CPU · {formatBytes(node.memoryBytes)} · Docker {node.engineVersion}
        </CardDescription>
      </CardHeader>
      <CardContent className="border-t pt-4">
        {node.stacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune app</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {node.stacks.map(stack => (
              <li key={stack.name} className="flex items-center gap-2">
                <span className={healthClass[stack.health]} title={healthLabel[stack.health]} aria-hidden>
                  {healthSymbol[stack.health]}
                </span>
                <span className="sr-only">{healthLabel[stack.health]}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{stack.name}</span>
                <span className="text-muted-foreground">{plural(stack.tasks, "tâche")}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
