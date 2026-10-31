"use client";

import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
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

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** The confirm button's label; "Confirm" in the reader's language by default. */
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
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation(CommonMessages);

  return (
    <AlertDialog open={open} onOpenChange={isOpen => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("confirm.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel ?? t("confirm.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
