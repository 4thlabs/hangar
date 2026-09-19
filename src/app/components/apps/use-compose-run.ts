"use client";

import { useState } from "react";
import { useRouter } from "waku";
import type { AppOperation } from "#app/actions/apps/app-operation.ts";
import type { DestructiveOperation } from "#app/components/apps/compose-operations.tsx";

/**
 * The state both compose callers hold: the app detail page acting on one project, and the apps
 * table acting on a selection. They differ only in what they target and how they word their
 * confirmation, so the running operation, the confirmation dialog and the reload live here.
 *
 * Nothing reports the outcome: the route notifies once each command ends, and the notification
 * comes back on its own stream — a toast raised here would be the same news, twice.
 *
 * @param projects The apps the next command applies to
 */
export function useComposeRun(projects: string[]) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<DestructiveOperation | null>(null);
  const [running, setRunning] = useState<AppOperation | null>(null);

  // Frozen when the command starts: the table's selection keeps moving under the user's clicks,
  // and the output sheet must keep streaming the apps the command actually got.
  const [targets, setTargets] = useState<string[]>([]);

  function run(operation: AppOperation) {
    if (projects.length === 0) return;

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
