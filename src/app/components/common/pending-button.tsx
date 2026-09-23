import type { ComponentProps, ReactNode } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";

type PendingButtonProps = ComponentProps<typeof Button> & {
  pending: boolean;
  /** Shown instead of the label while pending. */
  pendingLabel: ReactNode;
  /** Leading icon while idle, which the spinner replaces. */
  icon?: ReactNode;
};

/** A button that disables itself and swaps its icon and label for a spinner while its action runs. */
export function PendingButton({ pending, pendingLabel, icon, disabled, children, ...props }: PendingButtonProps) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {pending ? <Spinner data-icon="inline-start" /> : icon}
      {pending ? pendingLabel : children}
    </Button>
  );
}
