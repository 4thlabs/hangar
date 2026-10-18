"use client";

import { useState } from "react";
import { useRouter } from "waku";
import { AppCommands, type AppCommand, type UpFlag } from "#modules/apps/actions/app-operation.ts";
import { ToggledSet } from "#modules/common/toggled-set.ts";

/** Compose run state for the table and the detail page. No toast: the route's notification reports the outcome. */
export function useComposeRun(projects: string[]) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<AppCommand | null>(null);
  const [running, setRunning] = useState<AppCommand | null>(null);

  // The flags ticked in Up's menu, for this page visit only: never saved, and unticked once a run
  // starts, so a forced recreate never carries over to the next Up.
  const [flags, setFlags] = useState<ReadonlySet<UpFlag>>(() => new Set());

  // Frozen when the command starts: the table's selection keeps moving under the user's clicks,
  // and the output sheet must keep streaming the apps the command actually got.
  const [targets, setTargets] = useState<string[]>([]);

  function run(command: AppCommand) {
    if (projects.length === 0) {
      return;
    }

    setConfirmation(null);
    setFlags(new Set());
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
    flags,
    toggleFlag: (flag: UpFlag, ticked: boolean) => setFlags(current => ToggledSet.create(current, flag, ticked)),
    run,
    request,
    disabled: running !== null || projects.length === 0,
    close: () => setRunning(null),
    /** The command ended server-side; the page's data is stale. */
    finished: () => void router.reload(),
  };
}
