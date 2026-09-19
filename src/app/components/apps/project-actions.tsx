"use client";

import { useMemo } from "react";
import { actionLabel } from "#app/actions/apps/app-operation.ts";
import { ComposeConfirmDialog, ComposeOperationButtons } from "#app/components/apps/compose-operations.tsx";
import { ComposeOutputSheet } from "#app/components/apps/compose-output-sheet.tsx";
import { useComposeRun } from "#app/components/apps/use-compose-run.ts";

export function ProjectActions({ project }: { project: string }) {
  const projects = useMemo(() => [project], [project]);
  const { confirmation, setConfirmation, running, targets, run, disabled, close, finished } = useComposeRun(projects);

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
        projects={targets}
        operation={running}
        label={running ? actionLabel[running] : ""}
        onClose={close}
        onFinished={finished}
      />
    </div>
  );
}
