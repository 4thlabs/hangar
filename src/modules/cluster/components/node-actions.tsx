"use client";

import { useState } from "react";
import { useRouter } from "waku";
import type { SwarmManagerView, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { changeSwarmNode } from "#modules/cluster/actions/manage-cluster.ts";
import { NodeActionConfirmations } from "#modules/cluster/confirmations.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";

type NodeActionsProps = {
  cluster: SwarmManagerView;
  node: SwarmNode;
};

/** The actions that apply to one node, each behind a confirmation that states what it costs. */
export function NodeActions({ cluster, node }: NodeActionsProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [confirming, setConfirming] = useState<SwarmNodeAction | null>(null);
  const [running, setRunning] = useState<SwarmNodeAction | null>(null);
  const confirmation = confirming && NodeActionConfirmations.create(cluster, node, confirming);

  function confirm(action: SwarmNodeAction) {
    setConfirming(null);
    setRunning(action);
    run(
      () => changeSwarmNode(node.id, node.hostname, action),
      { success: ClusterLabels.NodeAction[action], error: `${ClusterLabels.NodeAction[action]} : échec` },
      async () => {
        setRunning(null);
        await router.reload();
      },
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {node.actions.map(action => (
          <PendingButton
            key={action}
            type="button"
            size="sm"
            variant={action === "remove" ? "destructive" : "outline"}
            pending={running === action}
            pendingLabel={ClusterLabels.NodeAction[action]}
            disabled={isPending}
            onClick={() => setConfirming(action)}
          >
            {ClusterLabels.NodeAction[action]}
          </PendingButton>
        ))}
      </div>

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        destructive={confirmation?.destructive ?? false}
        onConfirm={() => confirming && confirm(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
