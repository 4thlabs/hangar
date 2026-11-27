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
import { m } from "#paraglide/messages.js";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** The confirm button's label; "Confirm" by default. */
  confirmLabel?: string;
  /** Whether the action destroys something, which the confirm button shows. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The confirmation step before an action, with the wording left to the caller. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = m.common_actions_confirm(),
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={isOpen => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.common_actions_cancel()}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
