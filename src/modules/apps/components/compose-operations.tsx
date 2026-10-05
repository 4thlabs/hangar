"use client";

import { ArrowUpFromLineIcon, PowerIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { actionLabel, type AppOperation } from "#modules/apps/actions/app-operation.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#modules/common/ui/alert-dialog.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { ComposeOutputSheet } from "#modules/apps/components/compose-output-sheet.tsx";
import type { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";

/** Operations that replace or destroy containers, so the ones that need confirming before they run. */
export type DestructiveOperation = Exclude<AppOperation, "up">;

type ComposeOperationButtonsProps = {
  /** The operation currently running, which gets the spinner. `null` while idle. */
  running: AppOperation | null;
  disabled: boolean;
  size?: "sm" | undefined;
  /** `up` runs straight away; the other three are handed over for confirmation first. */
  onRun: (operation: "up") => void;
  onConfirm: (operation: DestructiveOperation) => void;
};

/**
 * The Up / Force recreate / Down triplet, shared by the apps table and the app detail page.
 *
 * Presentation only: what the two callers target differs (a selection, or the app being shown),
 * so only the buttons are shared. The state behind them lives in `useComposeRun`.
 */
export function ComposeOperationButtons({ running, disabled, size, onRun, onConfirm }: ComposeOperationButtonsProps) {
  const icon = (operation: AppOperation, Idle: typeof PowerIcon) =>
    running === operation ? <Spinner /> : <Idle data-icon="inline-start" />;

  return (
    <>
      <Button type="button" size={size} disabled={disabled} onClick={() => onRun("up")} title="docker compose up -d">
        {icon("up", PowerIcon)}
        {actionLabel.up}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => onConfirm("update")}
        title="docker compose up -d --pull always"
      >
        {icon("update", ArrowUpFromLineIcon)}
        {actionLabel.update}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => onConfirm("recreate")}
        title="docker compose up -d --force-recreate"
      >
        {icon("recreate", RefreshCwIcon)}
        {actionLabel.recreate}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={disabled}
        onClick={() => onConfirm("down")}
        title="docker compose down"
      >
        {icon("down", Trash2Icon)}
        {actionLabel.down}
      </Button>
    </>
  );
}

type ComposeConfirmDialogProps = {
  /** The operation awaiting confirmation, `null` keeping the dialog closed. */
  operation: DestructiveOperation | null;
  /** Wording differs by caller: one app by name, or N selected apps. */
  title: string;
  description: string;
  onConfirm: (operation: DestructiveOperation) => void;
  onCancel: () => void;
};

/** Confirmation step for the destructive operations, with the wording left to the caller. */
export function ComposeConfirmDialog({
  operation,
  title,
  description,
  onConfirm,
  onCancel,
}: ComposeConfirmDialogProps) {
  return (
    <AlertDialog open={operation !== null} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            variant={operation === "down" ? "destructive" : "default"}
            onClick={() => operation && onConfirm(operation)}
          >
            Confirmer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ComposeRunDialogsProps = {
  compose: ReturnType<typeof useComposeRun>;
  /** How the confirmation names its target: an app's name, or "3 applications". */
  subject: string;
  /** How many apps are targeted, which the confirmation's wording follows. */
  count: number;
};

/** The confirmation's wording for one app or for several, French agreeing in number. */
const TARGET_WORDING = {
  one: { apps: "cette application", staysListed: "Elle restera listée" },
  many: { apps: "ces applications", staysListed: "Elles resteront listées" },
};

/** The confirmation and the output sheet behind `ComposeOperationButtons`, for either caller. */
export function ComposeRunDialogs({ compose, subject, count }: ComposeRunDialogsProps) {
  const { confirmation, setConfirmation, running, targets, run, close, finished } = compose;
  const { apps, staysListed } = count > 1 ? TARGET_WORDING.many : TARGET_WORDING.one;
  const title: Record<DestructiveOperation, string> = {
    down: `Arrêter ${subject} ?`,
    recreate: `Recréer ${subject} ?`,
    update: `Mettre à jour ${subject} ?`,
  };
  const description: Record<DestructiveOperation, string> = {
    down: `Docker Compose supprimera les conteneurs et réseaux de ${apps}. ${staysListed}, à l’arrêt.`,
    recreate: `Tous les conteneurs de ${apps} seront recréés, même si leur configuration n’a pas changé.`,
    update: "Les images seront retirées du registre et les conteneurs recréés avec la nouvelle version.",
  };

  return (
    <>
      <ComposeConfirmDialog
        operation={confirmation}
        title={confirmation ? title[confirmation] : ""}
        description={confirmation ? description[confirmation] : ""}
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
    </>
  );
}
