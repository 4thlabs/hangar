"use client";

import { useState } from "react";
import { useRouter } from "waku";
import { AppCommands, type AppCommand } from "#modules/apps/actions/app-operation.ts";

/** Compose run state for the table and the detail page. No toast: the route's notification reports the outcome. */
export function useComposeRun(projects: string[]) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<AppCommand | null>(null);
  const [running, setRunning] = useState<AppCommand | null>(null);

  // Frozen when the command starts: the table's selection keeps moving under the user's clicks,
  // and the output sheet must keep streaming the apps the command actually got.
  const [targets, setTargets] = useState<string[]>([]);

  function run(command: AppCommand) {
    if (projects.length === 0) {
      return;
    }

    setConfirmation(null);
    setTargets(projects);
    setRunning(command);
  }

  /** Runs the command, after a confirmation when it takes the apps down. */
  function request(command: AppCommand) {
    if (AppCommands.needsConfirmation(command)) {
      setConfirmation(command);
    } else {
      run(command);
    }
  }

  return {
    confirmation,
    cancel: () => setConfirmation(null),
    running,
    targets,
    run,
    request,
    disabled: running !== null || projects.length === 0,
    close: () => setRunning(null),
    /** The command ended server-side; the page's data is stale. */
    finished: () => void router.reload(),
  };
}
