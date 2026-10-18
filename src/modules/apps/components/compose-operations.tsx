"use client";

import {
  ArrowUpFromLineIcon,
  ChevronDownIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { AppCommands, type AppCommand, type UpFlag } from "#modules/apps/actions/app-operation.ts";
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

type ComposeOperationButtonsProps = {
  /** The command currently running, which gets the spinner. `null` while idle. */
  running: AppCommand | null;
  disabled: boolean;
  size?: "sm" | undefined;
  /** Runs a command, after the confirmation it calls for (see `useComposeRun`). */
  onRequest: (command: AppCommand) => void;
};

/** How the operation buttons draw each command. */
class OperationIcons {
  static readonly Flag: Record<UpFlag, LucideIcon> = {
    pull: ArrowUpFromLineIcon,
    forceRecreate: RefreshCwIcon,
  };
}

/**
 * The compose operation buttons, shared by the apps table and the detail page; state lives in `useComposeRun`.
 * Grouped by command: Up carries its `up -d` variants in a menu, so adding one does not add a button.
 */
export function ComposeOperationButtons({ running, disabled, size, onRequest }: ComposeOperationButtonsProps) {
  const up = AppCommands.create("up");
  const restart = AppCommands.create("restart");
  const down = AppCommands.create("down");

  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size={size}
          disabled={disabled}
          onClick={() => onRequest(up)}
          title={AppCommands.commandLine(up)}
        >
          {running?.operation === "up" ? <Spinner /> : <PowerIcon data-icon="inline-start" />}
          {AppCommands.label(up)}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size={size === "sm" ? "icon-sm" : "icon"}
                disabled={disabled}
                aria-label={`Autres options de ${AppCommands.label(up)}`}
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
            {AppCommands.FlagOrder.map(flag => {
              const variant = AppCommands.create("up", [flag]);
              const Icon = OperationIcons.Flag[flag];

              return (
                <DropdownMenuItem key={flag} onClick={() => onRequest(variant)}>
                  <Icon />
                  <span className="flex flex-col">
                    {AppCommands.label(variant)}
                    <span className="font-mono text-xs text-muted-foreground">
                      {AppCommands.arguments(variant).join(" ")}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => onRequest(restart)}
        title={AppCommands.commandLine(restart)}
      >
        {running?.operation === "restart" ? <Spinner /> : <RotateCwIcon data-icon="inline-start" />}
        {AppCommands.label(restart)}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={disabled}
        onClick={() => onRequest(down)}
        title={AppCommands.commandLine(down)}
      >
        {running?.operation === "down" ? <Spinner /> : <Trash2Icon data-icon="inline-start" />}
        {AppCommands.label(down)}
      </Button>
    </>
  );
}

type ComposeConfirmDialogProps = {
  /** The command awaiting confirmation, `null` keeping the dialog closed. */
  command: AppCommand | null;
  /** Wording differs by caller: one app by name, or N selected apps. */
  title: string;
  description: string;
  onConfirm: (command: AppCommand) => void;
  onCancel: () => void;
};

/** Confirmation step for the commands that take apps down, with the wording left to the caller. */
export function ComposeConfirmDialog({ command, title, description, onConfirm, onCancel }: ComposeConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={command !== null}
      title={title}
      description={description}
      destructive={command?.operation === "down"}
      onConfirm={() => command && onConfirm(command)}
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

/** What a confirmation says before a compose command, French agreeing in number with the apps. */
class ComposeConfirmation {
  static readonly TargetWording = {
    one: { apps: "cette application", staysListed: "Elle restera listée" },
    many: { apps: "ces applications", staysListed: "Elles resteront listées" },
  };

  static title(command: AppCommand, subject: string) {
    if (command.operation === "down") {
      return `Arrêter ${subject} ?`;
    }

    return `${AppCommands.label(command)} ${subject} ?`;
  }

  static description(command: AppCommand, count: number) {
    const { apps, staysListed } =
      count > 1 ? ComposeConfirmation.TargetWording.many : ComposeConfirmation.TargetWording.one;

    if (command.operation === "down") {
      return `Docker Compose supprimera les conteneurs et réseaux de ${apps}. ${staysListed}, à l’arrêt.`;
    }

    if (command.operation === "restart") {
      return `Les conteneurs de ${apps} seront redémarrés sans être recréés : une configuration modifiée ne sera pas prise en compte.`;
    }

    return command.flags.map(flag => AppCommands.Flags[flag].consequence(apps)).join(" ");
  }
}

/** The confirmation and the output sheet behind `ComposeOperationButtons`, for either caller. */
export function ComposeRunDialogs({ compose, subject, count }: ComposeRunDialogsProps) {
  const { confirmation, cancel, running, targets, run, close, finished } = compose;

  return (
    <>
      <ComposeConfirmDialog
        command={confirmation}
        title={confirmation ? ComposeConfirmation.title(confirmation, subject) : ""}
        description={confirmation ? ComposeConfirmation.description(confirmation, count) : ""}
        onConfirm={run}
        onCancel={cancel}
      />
      <ComposeOutputSheet projects={targets} command={running} onClose={close} onFinished={finished} />
    </>
  );
}
