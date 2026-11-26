import {
  ArrowUpFromLineIcon,
  ChevronDownIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import type { ComposeAction } from "#libs/api";
import { ComposeOutputSheet } from "#modules/apps/components/compose-output-sheet.tsx";
import type { ComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import {
  composeCommandLine,
  confirmationDescription,
  confirmationTitle,
  upAction,
  upFlagOrder,
  upFlagSpecs,
  type ComposeOperation,
  type UpFlag,
} from "#modules/common/helpers/compose-actions.ts";
import { ButtonGroup } from "#modules/common/ui/button-group.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

/** How the operation buttons draw each option of Up. */
const upFlagIcons: Readonly<Record<UpFlag, LucideIcon>> = {
  pull: ArrowUpFromLineIcon,
  forceRecreate: RefreshCwIcon,
};

type ComposeOperationButtonsProps = {
  compose: ComposeCommand;
  size?: "sm" | undefined;
};

/**
 * The compose buttons, shared by the apps table and an app's page; their state is `useComposeCommand`'s. Up's options
 * are checkboxes in its menu, so that a new option adds no button.
 */
export function ComposeOperationButtons({ compose, size }: ComposeOperationButtonsProps) {
  const up = upAction(compose.flags);
  const restart: ComposeAction = { operation: "restart" };
  const down: ComposeAction = { operation: "down" };
  const runningOperation = compose.isRunning ? compose.shown?.action.operation : undefined;

  const icon = (operation: ComposeOperation, Icon: LucideIcon) =>
    runningOperation === operation ? <Spinner /> : <Icon data-icon="inline-start" />;

  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          size={size}
          disabled={compose.disabled}
          onClick={() => compose.request(up)}
          title={composeCommandLine(up)}
          // The count alone does not say which options: the name gives the whole command.
          aria-label={`Up: ${composeCommandLine(up)}`}
        >
          {icon("up", PowerIcon)}
          Up
          {compose.flags.size > 0 && <span className="opacity-70">· {compose.flags.size}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size={size === "sm" ? "icon-sm" : "icon"}
                disabled={compose.disabled}
                aria-label="Up options"
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-60">
            {upFlagOrder.map(flag => {
              const Icon = upFlagIcons[flag];

              return (
                <DropdownMenuCheckboxItem
                  key={flag}
                  checked={compose.flags.has(flag)}
                  onCheckedChange={ticked => compose.toggleFlag(flag, ticked)}
                >
                  <Icon />
                  <span className="flex flex-col">
                    {upFlagSpecs[flag].label}
                    <span className="font-mono text-xs text-muted-foreground">
                      {upFlagSpecs[flag].arguments.join(" ")}
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
        disabled={compose.disabled}
        onClick={() => compose.request(restart)}
        title={composeCommandLine(restart)}
      >
        {icon("restart", RotateCwIcon)}
        Restart
      </Button>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={compose.disabled}
        onClick={() => compose.request(down)}
        title={composeCommandLine(down)}
      >
        {icon("down", Trash2Icon)}
        Down
      </Button>
    </>
  );
}

type ComposeDialogsProps = {
  compose: ComposeCommand;
  /** How the confirmation names its apps: an app's name, or "3 apps". */
  subject: string;
  /** How many apps, which the confirmation's wording agrees with. */
  count: number;
};

/** The confirmation and the output panel behind `ComposeOperationButtons`, for either page. */
export function ComposeDialogs({ compose, subject, count }: ComposeDialogsProps) {
  const { confirmation } = compose;

  return (
    <>
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation ? confirmationTitle(confirmation, subject) : ""}
        description={confirmation ? confirmationDescription(confirmation, count) : ""}
        destructive={confirmation?.operation === "down"}
        onConfirm={() => confirmation && compose.run(confirmation)}
        onCancel={compose.cancel}
      />
      <ComposeOutputSheet compose={compose} />
    </>
  );
}
