import { useState } from "react";
import type { ComposeAction, ComposeBatch } from "#libs/api";
import { ComposeActions, type UpFlag } from "#modules/apps/compose-actions.ts";
import { useComposeStream } from "#modules/apps/hooks/use-compose-stream.ts";
import { ToggledSet } from "#modules/common/toggled-set.ts";

/** The batch the output panel shows: its command and its apps, in the order they run. */
export type ShownBatch = { action: ComposeAction; apps: readonly string[] };

/**
 * The compose commands of the table and of an app's page, on `apps`: the confirmation, Up's options, and the output
 * of the batch the panel shows, one this page started or one the server ran already. No toast: the server notifies
 * each app's end, and the page reads the apps again as the daemon's changes come.
 */
export function useComposeCommand(apps: readonly string[]) {
  const stream = useComposeStream();
  const [confirmation, setConfirmation] = useState<ComposeAction | null>(null);
  const [shown, setShown] = useState<ShownBatch | null>(null);

  // The options ticked in Up's menu, for this page visit only: never saved, and unticked once a run starts, so that a
  // forced recreate never carries over to the next Up.
  const [flags, setFlags] = useState<ReadonlySet<UpFlag>>(() => new Set());

  const isRunning = shown !== null && (stream.status === "connecting" || stream.status === "connected");

  /** Runs `action` on the apps as they are now: the table's selection may change under the panel. */
  function run(action: ComposeAction) {
    if (apps.length === 0) {
      return;
    }

    setConfirmation(null);
    setFlags(new Set());
    setShown({ action, apps });
    stream.start({ action, apps: [...apps] });
  }

  /** Runs `action`, after a confirmation when it takes the apps down. */
  function request(action: ComposeAction) {
    if (ComposeActions.needsConfirmation(action)) {
      setConfirmation(action);
    } else {
      run(action);
    }
  }

  /** Shows the output of `batch`, which the server runs already, from its start. */
  function show(batch: ComposeBatch) {
    setShown({ action: batch.action, apps: batch.apps });
    stream.follow(batch);
  }

  /** Closes the panel; the batch goes on on the server. */
  function close() {
    stream.stop();
    setShown(null);
  }

  return {
    confirmation,
    cancel: () => setConfirmation(null),
    flags,
    toggleFlag: (flag: UpFlag, ticked: boolean) => setFlags(current => ToggledSet.create(current, flag, ticked)),
    request,
    run,
    show,
    close,
    shown,
    isRunning,
    disabled: isRunning || apps.length === 0,
    output: stream.output,
    status: stream.status,
    error: stream.error,
  };
}

/** What `useComposeCommand` gives. */
export type ComposeCommand = ReturnType<typeof useComposeCommand>;
