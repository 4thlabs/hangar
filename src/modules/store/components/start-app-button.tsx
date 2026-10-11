"use client";

import { PlayIcon } from "lucide-react";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { startApp } from "#modules/store/actions/store-apps.ts";
import { useUnfilledVariables } from "#modules/store/hooks/use-unfilled-variables.ts";
import { UnfilledNote } from "#modules/store/unfilled-note.ts";

type StartAppButtonProps = {
  appId: string;
  appName: string;
};

/**
 * "Démarrer": `docker compose up -d` for a store app, independent of its swarm stack. Starts at once,
 * unless some of its variables are still empty, which it asks to confirm first.
 */
export function StartAppButton({ appId, appName }: StartAppButtonProps) {
  const { run, isPending } = useServerAction();
  const { check, isChecking, unfilled, confirm, dismiss } = useUnfilledVariables(appId);

  function start() {
    dismiss();
    run(() => startApp(appId), { success: "Application démarrée", error: "Échec du démarrage" });
  }

  const isBusy = isPending || isChecking;

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        className="absolute top-1.5 right-1.5"
        disabled={isBusy}
        onClick={() => check(variables => (variables.length === 0 ? start() : confirm(variables)))}
        aria-label={`Démarrer ${appName}`}
        title="Démarrer"
      >
        {isBusy ? <Spinner /> : <PlayIcon />}
      </Button>
      <ConfirmDialog
        open={unfilled !== null}
        title={`Démarrer ${appName} ?`}
        description={`Elle est démarrée avec docker compose.${UnfilledNote.describe(unfilled ?? [])}`}
        confirmLabel="Démarrer"
        onConfirm={start}
        onCancel={dismiss}
      />
    </>
  );
}
