"use client";

import { useState } from "react";
import { useRouter } from "waku";
import type { SwarmManagerView, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { changeSwarmNode } from "#modules/cluster/actions/manage-cluster.ts";
import { NodeActionConfirmations } from "#modules/cluster/confirmations.ts";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type NodeActionsProps = {
  cluster: SwarmManagerView;
  node: SwarmNode;
};

/** The actions that apply to one node, each behind a confirmation that states what it costs. */
export function NodeActions({ cluster, node }: NodeActionsProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(ClusterMessages);
  const [confirming, setConfirming] = useState<SwarmNodeAction | null>(null);
  const [running, setRunning] = useState<SwarmNodeAction | null>(null);
  const confirmation = confirming && NodeActionConfirmations.create(cluster, node, confirming, t);

  function confirm(action: SwarmNodeAction) {
    setConfirming(null);
    setRunning(action);

    const label = t(`nodeAction.${action}`);

    run(
      () => changeSwarmNode(node.id, node.hostname, action),
      { success: label, error: t("nodeActionFailed", { action: label }) },
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
            pendingLabel={t(`nodeAction.${action}`)}
            disabled={isPending}
            onClick={() => setConfirming(action)}
          >
            {t(`nodeAction.${action}`)}
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
