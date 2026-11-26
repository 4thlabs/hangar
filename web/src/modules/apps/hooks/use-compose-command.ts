import { useState } from "react";
import { useComposeBatches, type ComposeAction, type ComposeBatch } from "#libs/api";
import { needsConfirmation, type UpFlag } from "#modules/apps/compose-actions.ts";
import { useComposeStream } from "#modules/apps/hooks/use-compose-stream.ts";
import { toggledSet } from "#modules/common/toggled-set.ts";

/** The batch the output panel shows: its command and its apps. */
export type ShownBatch = { action: ComposeAction; apps: readonly string[] };

/**
 * The compose commands of the table and of an app's page, on `apps`: the confirmation, Up's options, the batches the
 * server runs, whichever page started them, whose apps' buttons are disabled, and the output of the batch the panel
 * shows, one this page started or one the server ran already. No toast: the server notifies each app's end, and the
 * page reads the apps again as the daemon's changes come.
 */
export function useComposeCommand(apps: readonly string[]) {
  const stream = useComposeStream();
  const [confirmation, setConfirmation] = useState<ComposeAction | null>(null);
  const [shown, setShown] = useState<ShownBatch | null>(null);
  // The options ticked in Up's menu, for this page visit only: never saved, and unticked once a run starts, so that a
  // forced recreate never carries over to the next Up.
  const [flags, setFlags] = useState<ReadonlySet<UpFlag>>(() => new Set());

  // Read again as a batch starts or ends, whichever page started it, which the server says on its Docker changes.
  const { data: batches } = useComposeBatches();

  const running = (batches ?? []).filter(batch => batch.report === null);
  const isHeld = apps.some(app => running.some(batch => batch.apps.includes(app)));

  // A selection emptied under the confirmation leaves it nothing to confirm.
  if (confirmation !== null && apps.length === 0) {
    setConfirmation(null);
  }

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
    if (needsConfirmation(action)) {
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
    toggleFlag: (flag: UpFlag, ticked: boolean) => setFlags(current => toggledSet(current, flag, ticked)),
    request,
    run,
    show,
    close,
    shown,
    isRunning,
    /** The batches the server runs, whichever page started them. */
    running,
    disabled: isRunning || isHeld || apps.length === 0,
    output: stream.output,
    status: stream.status,
    error: stream.error,
  };
}

/** What `useComposeCommand` gives. */
export type ComposeCommand = ReturnType<typeof useComposeCommand>;
