"use client";

import { useCallback, useState } from "react";
import { useRouter } from "waku";
import { ActionResult } from "#app/actions/action-result.ts";
import { actionLabel, type AppOperation } from "#app/actions/apps/app-operation.ts";
import {
  ComposeConfirmDialog,
  ComposeOperationButtons,
  type DestructiveOperation,
} from "#app/components/apps/compose-operations.tsx";
import { ComposeOutputSheet } from "#app/components/apps/compose-output-sheet.tsx";
import { createActionToast, createTransportErrorToast } from "#app/components/common/action-toast.ts";
import { toast } from "#app/components/ui/toast.tsx";

export function ProjectActions({ project }: { project: string }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<DestructiveOperation | null>(null);
  const [running, setRunning] = useState<AppOperation | null>(null);
  const disabled = running !== null;

  function run(operation: AppOperation) {
    setConfirmation(null);
    setRunning(operation);
  }

  // The command keeps running server-side after the sheet closes, so the outcome is
  // reported from the stream's exit marker rather than from the panel being open.
  const finished = useCallback(
    (operation: AppOperation, code: number | null) => {
      const label = actionLabel[operation];

      toast.add(
        code === null
          ? createTransportErrorToast(`${label} interrompu`, "Le flux de sortie a été interrompu.")
          : createActionToast(
              code === 0
                ? ActionResult.success(`${project} : la commande s’est terminée.`)
                : ActionResult.failure(`Docker Compose a terminé avec le code ${code}.`),
              { success: `${label} terminé`, error: `${label} échoué` },
            ),
      );

      void router.reload();
    },
    [project, router],
  );

  const confirmationTitle = confirmation === "down" ? `Arrêter ${project} ?` : `Recréer ${project} ?`;
  const confirmationDescription =
    confirmation === "down"
      ? "Docker Compose supprimera les conteneurs et réseaux de cette application. Elle restera listée, à l’arrêt, tant qu’elle ne sera pas relancée."
      : "Tous les conteneurs de cette application seront recréés, même si leur configuration n’a pas changé.";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ComposeOperationButtons running={running} disabled={disabled} onRun={run} onConfirm={setConfirmation} />

      <ComposeConfirmDialog
        operation={confirmation}
        title={confirmationTitle}
        description={confirmationDescription}
        onConfirm={run}
        onCancel={() => setConfirmation(null)}
      />

      <ComposeOutputSheet
        project={project}
        operation={running}
        label={running ? actionLabel[running] : ""}
        onClose={() => setRunning(null)}
        onFinished={code => running && finished(running, code)}
      />
    </div>
  );
}
