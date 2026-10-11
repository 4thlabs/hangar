import type { SwarmManagerView, SwarmNode } from "#libs/docker";
import { formatBytes, plural } from "#modules/apps/format.ts";
import { NodeActions } from "#modules/cluster/components/node-actions.tsx";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type NodeCardProps = {
  cluster: SwarmManagerView;
  node: SwarmNode;
};

/** One node of the swarm: what it is, how busy, and what can be changed on it. Its stacks are in the list below. */
export function NodeCard({ cluster, node }: NodeCardProps) {
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
        <CardDescription>{node.tasks === 0 ? "Aucune tâche" : plural(node.tasks, "tâche")}</CardDescription>
      </CardHeader>
      {node.actions.length > 0 && (
        <CardFooter className="mt-auto">
          <NodeActions cluster={cluster} node={node} />
        </CardFooter>
      )}
    </Card>
  );
}
