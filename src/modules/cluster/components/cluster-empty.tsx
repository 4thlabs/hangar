import type { SwarmLimitedView } from "#libs/docker";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#modules/common/ui/empty.tsx";

/** What /cluster shows when this node cannot describe the cluster, with the command that moves it on. */
export function ClusterEmpty({ cluster }: { cluster: SwarmLimitedView }) {
  const text = ClusterLabels.empty(cluster);

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <text.icon />
        </EmptyMedia>
        <EmptyTitle>{text.title}</EmptyTitle>
        <EmptyDescription>{text.description}</EmptyDescription>
      </EmptyHeader>
      {text.command && (
        <EmptyContent>
          <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm">{text.command}</code>
        </EmptyContent>
      )}
    </Empty>
  );
}
