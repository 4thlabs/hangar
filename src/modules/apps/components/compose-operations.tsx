"use client";

import {
  ArrowUpFromLineIcon,
  ChevronDownIcon,
  PowerIcon,
  RefreshCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { actionLabel, type AppOperation } from "#modules/apps/actions/app-operation.ts";
import { ComposeOutputSheet } from "#modules/apps/components/compose-output-sheet.tsx";
import type { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { ButtonGroup } from "#modules/common/ui/button-group.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** Operations that replace or destroy containers, so the ones that need confirming before they run. */
export type DestructiveOperation = Exclude<AppOperation, "up">;

type ComposeOperationButtonsProps = {
  /** The operation currently running, which gets the spinner. `null` while idle. */
  running: AppOperation | null;
  disabled: boolean;
  size?: "sm" | undefined;
  /** `up` runs straight away; the others are handed over for confirmation first. */
  onRun: (operation: "up") => void;
  onConfirm: (operation: DestructiveOperation) => void;
};

/** The operations reached from Up's menu: `up -d` with one flag more. */
class UpVariants {
  static readonly All = [
    { operation: "update", icon: ArrowUpFromLineIcon, command: "up -d --pull always" },
    { operation: "recreate", icon: RefreshCwIcon, command: "up -d --force-recreate" },
  ] as const satisfies readonly { operation: DestructiveOperation; icon: LucideIcon; command: string }[];

  static includes(operation: AppOperation | null) {
    return UpVariants.All.some(variant => variant.operation === operation);
  }
}

/**
 * The compose operation buttons, shared by the apps table and the detail page; state lives in `useComposeRun`.
 * Grouped by command: Up carries its `up -d` variants in a menu, so adding an operation does not add a button.
 */
export function ComposeOperationButtons({ running, disabled, size, onRun, onConfirm }: ComposeOperationButtonsProps) {
  const upRunning = running === "up" || UpVariants.includes(running);

  return (
    <>
      <ButtonGroup>
        <Button type="button" size={size} disabled={disabled} onClick={() => onRun("up")} title="docker compose up -d">
          {upRunning ? <Spinner /> : <PowerIcon data-icon="inline-start" />}
          {actionLabel.up}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size={size === "sm" ? "icon-sm" : "icon"}
                disabled={disabled}
                aria-label={`Autres options de ${actionLabel.up}`}
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
            {UpVariants.All.map(({ operation, icon: Icon, command }) => (
              <DropdownMenuItem key={operation} onClick={() => onConfirm(operation)}>
                <Icon />
                <span className="flex flex-col">
                  {actionLabel[operation]}
                  <span className="font-mono text-xs text-muted-foreground">{command}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={disabled}
        onClick={() => onConfirm("down")}
        title="docker compose down"
      >
        {running === "down" ? <Spinner /> : <Trash2Icon data-icon="inline-start" />}
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
    <ConfirmDialog
      open={operation !== null}
      title={title}
      description={description}
      destructive={operation === "down"}
      onConfirm={() => operation && onConfirm(operation)}
      onCancel={onCancel}
    />
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
