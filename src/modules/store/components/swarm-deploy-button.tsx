"use client";

import { NetworkIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
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
import { deployToSwarm } from "#modules/store/actions/store-apps.ts";

type SwarmDeployButtonProps = {
  appId: string;
  appName: string;
  /** Whether it runs with compose now, whose containers the deploy takes down first. */
  installed: boolean;
};

/** "Déployer sur le swarm", next to the install button of an app that ships a compose.swarm.yml. */
export function SwarmDeployButton({ appId, appName, installed }: SwarmDeployButtonProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [confirming, setConfirming] = useState(false);

  const composeNote = installed
    ? " Ses conteneurs compose sont d’abord arrêtés, pour qu’elle ne tourne pas deux fois."
    : "";

  function deploy() {
    setConfirming(false);
    run(
      () => deployToSwarm(appId),
      { success: "Déployée sur le swarm", error: "Échec du déploiement" },
      () => router.reload(),
    );
  }

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        className="absolute top-1.5 right-8"
        disabled={isPending}
        onClick={() => setConfirming(true)}
        aria-label={`Déployer ${appName} sur le swarm`}
        title="Déployer sur le swarm"
      >
        {isPending ? <Spinner /> : <NetworkIcon />}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déployer {appName} sur le swarm ?</AlertDialogTitle>
            <AlertDialogDescription>
              {`L’app est ajoutée à la liste swarm de hangar.yml, puis déployée avec compose.yml et compose.swarm.yml. Elle apparaîtra sur la page Cluster, plus sur Apps.${composeNote}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deploy}>Déployer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
