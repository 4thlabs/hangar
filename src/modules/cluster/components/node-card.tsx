import type { SwarmManagerView, SwarmNode } from "#libs/docker";
import { formatBytes, plural } from "#modules/apps/format.ts";
import { NodeActions } from "#modules/cluster/components/node-actions.tsx";
import { NodeLabelBadge } from "#modules/cluster/components/node-label-badge.tsx";
import { NodeLabelsDialog } from "#modules/cluster/components/node-labels-dialog.tsx";
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
  const labels = Object.entries(node.labels).sort(([a], [b]) => a.localeCompare(b));
  const engineLabels = Object.entries(node.engineLabels).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {node.hostname}
          {isCurrent && <span className="text-xs font-normal text-muted-foreground">★ ce nœud</span>}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={ClusterLabels.roleVariant(node)}
            title={ClusterLabels.isOutsideRaft(node) ? ClusterLabels.OutsideRaftHint : undefined}
          >
            {ClusterLabels.role(node)}
          </Badge>
          <Badge variant={ClusterLabels.nodeStatusVariant(node.status)}>{ClusterLabels.NodeStatus[node.status]}</Badge>
          <Badge variant={ClusterLabels.availabilityVariant(node.availability)}>
            {ClusterLabels.Availability[node.availability]}
          </Badge>
        </div>
        <CardDescription>
          {node.cpus} CPU · {formatBytes(node.memoryBytes)} · Docker {node.engineVersion}
        </CardDescription>
        <CardDescription>{node.tasks === 0 ? "Aucune tâche" : plural(node.tasks, "tâche")}</CardDescription>
        {labels.length + engineLabels.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Labels">
            {labels.map(([key, value]) => (
              <li key={key} className="max-w-full">
                <NodeLabelBadge name={key} value={value} source="node" />
              </li>
            ))}
            {engineLabels.map(([key, value]) => (
              <li key={`engine.${key}`} className="max-w-full">
                <NodeLabelBadge name={key} value={value} source="engine" />
              </li>
            ))}
          </ul>
        )}
      </CardHeader>
      <CardFooter className="mt-auto flex-wrap gap-2">
        <NodeLabelsDialog node={node} />
        {node.actions.length > 0 && <NodeActions cluster={cluster} node={node} />}
      </CardFooter>
    </Card>
  );
}
