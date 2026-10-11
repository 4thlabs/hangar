"use client";

import { useState } from "react";
import { useRouter } from "waku";
import type { SwarmCluster, SwarmNode, SwarmNodeAction } from "#libs/docker";
import { changeSwarmNode } from "#modules/cluster/actions/manage-cluster.ts";
import { nodeActionConfirmation } from "#modules/cluster/confirmations.ts";
import { nodeActionLabel } from "#modules/cluster/status.ts";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#modules/common/ui/alert-dialog.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type NodeActionsProps = {
  cluster: Extract<SwarmCluster, { state: "manager" }>;
  node: SwarmNode;
};

/** The actions that apply to one node, each behind a confirmation that states what it costs. */
export function NodeActions({ cluster, node }: NodeActionsProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [confirming, setConfirming] = useState<SwarmNodeAction | null>(null);
  const [running, setRunning] = useState<SwarmNodeAction | null>(null);
  const confirmation = confirming && nodeActionConfirmation(cluster, node, confirming);

  function confirm(action: SwarmNodeAction) {
    setConfirming(null);
    setRunning(action);
    run(
      () => changeSwarmNode(node.id, node.hostname, action),
      { success: nodeActionLabel[action], error: `${nodeActionLabel[action]} : échec` },
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
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "remove" ? "destructive" : "outline"}
            disabled={isPending}
            onClick={() => setConfirming(action)}
          >
            {running === action && <Spinner data-icon="inline-start" />}
            {nodeActionLabel[action]}
          </Button>
        ))}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={open => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.destructive ? "destructive" : "default"}
              onClick={() => confirming && confirm(confirming)}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
