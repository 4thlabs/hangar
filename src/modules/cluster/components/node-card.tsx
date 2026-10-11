import type { SwarmManagerView, SwarmNode } from "#libs/docker";
import { formatBytes, plural } from "#modules/apps/format.ts";
import { NodeActions } from "#modules/cluster/components/node-actions.tsx";
import { StackLine } from "#modules/cluster/components/stack-line.tsx";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type NodeCardProps = {
  cluster: SwarmManagerView;
  node: SwarmNode;
  /** Opens the sheet of a stack, from its line. */
  onOpenStack: (stack: string) => void;
};

/** One node of the swarm: what it is, the stacks with tasks running on it, and what can be changed on it. */
export function NodeCard({ cluster, node, onOpenStack }: NodeCardProps) {
  const isCurrent = node.id === cluster.currentNodeId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {node.hostname}
          {isCurrent && <span className="text-xs font-normal text-muted-foreground">★ ce nœud</span>}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={node.role === "worker" ? "outline" : "default"}>{ClusterLabels.Role[node.role]}</Badge>
          <Badge variant={ClusterLabels.nodeStatusVariant(node.status)}>{ClusterLabels.NodeStatus[node.status]}</Badge>
          <Badge variant={ClusterLabels.availabilityVariant(node.availability)}>
            {ClusterLabels.Availability[node.availability]}
          </Badge>
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
              <li key={stack.name}>
                <StackLine
                  name={stack.name}
                  health={stack.health}
                  detail={plural(stack.tasks, "tâche")}
                  onOpen={onOpenStack}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {node.actions.length > 0 && (
        <CardFooter className="mt-auto">
          <NodeActions cluster={cluster} node={node} />
        </CardFooter>
      )}
    </Card>
  );
}
