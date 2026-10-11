"use client";

import { NetworkIcon } from "lucide-react";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { deployToSwarm } from "#modules/store/actions/store-apps.ts";
import { useUnfilledVariables } from "#modules/store/hooks/use-unfilled-variables.ts";
import { UnfilledNote } from "#modules/store/unfilled-note.ts";

type SwarmDeployButtonProps = {
  appId: string;
  appName: string;
};

/** "Déployer sur le swarm", beside "Démarrer" on an app that ships a compose.swarm.yml, and independent of it. */
export function SwarmDeployButton({ appId, appName }: SwarmDeployButtonProps) {
  const { run, isPending } = useServerAction();
  const { check, isChecking, unfilled, confirm, dismiss } = useUnfilledVariables(appId);

  function deploy() {
    dismiss();
    run(() => deployToSwarm(appId), { success: "Déployée sur le swarm", error: "Échec du déploiement" });
  }

  const isBusy = isPending || isChecking;

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        className="absolute top-1.5 right-8"
        disabled={isBusy}
        onClick={() => check(confirm)}
        aria-label={`Déployer ${appName} sur le swarm`}
        title="Déployer sur le swarm"
      >
        {isBusy ? <Spinner /> : <NetworkIcon />}
      </Button>
      <ConfirmDialog
        open={unfilled !== null}
        title={`Déployer ${appName} sur le swarm ?`}
        description={`Elle est déployée avec compose.yml et compose.swarm.yml, et apparaîtra sur la page Cluster. Ses conteneurs compose, s’ils tournent, ne sont pas touchés : avec les mêmes volumes, attention aux deux copies.${UnfilledNote.describe(unfilled ?? [])}`}
        confirmLabel="Déployer"
        onConfirm={deploy}
        onCancel={dismiss}
      />
    </>
  );
}
