"use client";

import { ComposeOperationButtons, ComposeRunDialogs } from "#modules/apps/components/compose-operations.tsx";
import { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";

export function ProjectActions({ project }: { project: string }) {
  const compose = useComposeRun([project]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ComposeOperationButtons running={compose.running} disabled={compose.disabled} onRequest={compose.request} />
      <ComposeRunDialogs compose={compose} subject={project} count={1} />
    </div>
  );
}
