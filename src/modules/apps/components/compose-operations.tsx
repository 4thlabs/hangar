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
import type { Translate } from "#libs/i18n";
import { AppCommands, type AppCommand, type UpFlag } from "#modules/apps/actions/app-operation.ts";
import { ComposeOutputSheet } from "#modules/apps/components/compose-output-sheet.tsx";
import type { useComposeRun } from "#modules/apps/hooks/use-compose-run.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { ButtonGroup } from "#modules/common/ui/button-group.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type ComposeOperationButtonsProps = {
  /** The command currently running, which gets the spinner. `null` while idle. */
  running: AppCommand | null;
  disabled: boolean;
  size?: "sm" | undefined;
  /** The flags ticked in Up's menu, which Up runs with. */
  flags: ReadonlySet<UpFlag>;
  onToggleFlag: (flag: UpFlag, ticked: boolean) => void;
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
 * Grouped by command: Up's flags are checkboxes in its menu, so a new flag does not add a button.
 */
export function ComposeOperationButtons({
  running,
  disabled,
  size,
  flags,
  onToggleFlag,
  onRequest,
}: ComposeOperationButtonsProps) {
  const { t } = useTranslation(AppsMessages);
  const upLabel = t("commands.operation.up");
  const up = AppCommands.create("up", flags);
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
          // The count alone does not say which flags; the name gives the whole command.
          aria-label={t("commands.named", { label: upLabel, commandLine: AppCommands.commandLine(up) })}
        >
          {running?.operation === "up" ? <Spinner /> : <PowerIcon data-icon="inline-start" />}
          {upLabel}
          {up.flags.length > 0 && <span className="opacity-70">· {up.flags.length}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size={size === "sm" ? "icon-sm" : "icon"}
                disabled={disabled}
                aria-label={t("commands.options", { operation: upLabel })}
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-60">
            {AppCommands.FlagOrder.map(flag => {
              const Icon = OperationIcons.Flag[flag];

              return (
                <DropdownMenuCheckboxItem
                  key={flag}
                  checked={flags.has(flag)}
                  onCheckedChange={ticked => onToggleFlag(flag, ticked)}
                >
                  <Icon />
                  <span className="flex flex-col">
                    {t(`commands.flags.${flag}.label`)}
                    <span className="font-mono text-xs text-muted-foreground">
                      {AppCommands.Flags[flag].arguments.join(" ")}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
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
        {AppCommands.label(restart, t)}
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
        {AppCommands.label(down, t)}
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

/** What a confirmation says before a compose command, agreeing in number with the apps. */
class ComposeConfirmation {
  static title(command: AppCommand, subject: string, t: Translate<typeof AppsMessages.en>) {
    if (command.operation === "down") {
      return t("commands.confirm.stopTitle", { subject });
    }

    return t("commands.confirm.title", { label: AppCommands.label(command, t), subject });
  }

  static description(command: AppCommand, count: number, t: Translate<typeof AppsMessages.en>) {
    const target = count > 1 ? "many" : "one";
    const apps = t(`commands.confirm.target.${target}.apps`);

    if (command.operation === "down") {
      return t("commands.confirm.down", { apps, staysListed: t(`commands.confirm.target.${target}.staysListed`) });
    }

    if (command.operation === "restart") {
      return t("commands.confirm.restart", { apps });
    }

    return command.flags.map(flag => t(`commands.flags.${flag}.consequence`, { apps })).join(" ");
  }
}

/** The confirmation and the output sheet behind `ComposeOperationButtons`, for either caller. */
export function ComposeRunDialogs({ compose, subject, count }: ComposeRunDialogsProps) {
  const { confirmation, cancel, running, targets, run, close, finished } = compose;
  const { t } = useTranslation(AppsMessages);

  return (
    <>
      <ComposeConfirmDialog
        command={confirmation}
        title={confirmation ? ComposeConfirmation.title(confirmation, subject, t) : ""}
        description={confirmation ? ComposeConfirmation.description(confirmation, count, t) : ""}
        onConfirm={run}
        onCancel={cancel}
      />
      <ComposeOutputSheet projects={targets} command={running} onClose={close} onFinished={finished} />
    </>
  );
}
