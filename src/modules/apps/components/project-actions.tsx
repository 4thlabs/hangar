"use client";

import { useMemo } from "react";
import { ComposeOperationButtons, ComposeRunDialogs } from "#modules/apps/components/compose-operations.tsx";
import { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";

export function ProjectActions({ project }: { project: string }) {
  const projects = useMemo(() => [project], [project]);
  const compose = useComposeRun(projects);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ComposeOperationButtons
        running={compose.running}
        disabled={compose.disabled}
        onRun={compose.run}
        onConfirm={compose.setConfirmation}
      />
      <ComposeRunDialogs compose={compose} subject={project} count={1} />
    </div>
  );
}
