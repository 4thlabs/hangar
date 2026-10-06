"use client";

import { useState } from "react";
import { useRouter } from "waku";
import type { AppOperation } from "#modules/apps/actions/app-operation.ts";
import type { DestructiveOperation } from "#modules/apps/components/compose-operations.tsx";

/** Compose run state for the table and the detail page. No toast: the route's notification reports the outcome. */
export function useComposeRun(projects: string[]) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<DestructiveOperation | null>(null);
  const [running, setRunning] = useState<AppOperation | null>(null);

  // Frozen when the command starts: the table's selection keeps moving under the user's clicks,
  // and the output sheet must keep streaming the apps the command actually got.
  const [targets, setTargets] = useState<string[]>([]);

  function run(operation: AppOperation) {
    if (projects.length === 0) {
      return;
    }

    setConfirmation(null);
    setTargets(projects);
    setRunning(operation);
  }

  return {
    confirmation,
    setConfirmation,
    running,
    targets,
    run,
    disabled: running !== null || projects.length === 0,
    close: () => setRunning(null),
    /** The command ended server-side; the page's data is stale. */
    finished: () => void router.reload(),
  };
}
