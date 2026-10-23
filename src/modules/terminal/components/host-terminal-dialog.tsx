"use client";

import { SquareTerminalIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#modules/common/ui/dialog.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#modules/common/ui/tooltip.tsx";

type HostTerminalDialogProps = {
  /** The host and account the shell signs in to, or that none is configured. */
  description: string;
  /** The **Clé SSH** dialog, next to the title. */
  sshKey: ReactNode;
  /** The terminal, or how to configure it. */
  children: ReactNode;
};

/**
 * The navbar's terminal button and its dialog. The terminal mounts at the first opening, then stays mounted
 * while the dialog is closed, its stream still open: reopening finds it as it was. The server keeps the
 * session past a reload too.
 */
export function HostTerminalDialog({ description, sshKey, children }: HostTerminalDialogProps) {
  const [wasOpened, setWasOpened] = useState(false);

  function handleOpenChange(open: boolean) {
    if (open) {
      setWasOpened(true);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={<DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Terminal" />} />}
        >
          <SquareTerminalIcon />
        </TooltipTrigger>
        <TooltipContent>Terminal</TooltipContent>
      </Tooltip>
      <DialogContent keepMounted className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4 pr-8">
          <DialogHeader>
            <DialogTitle>Terminal</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {sshKey}
        </div>
        {wasOpened && children}
      </DialogContent>
    </Dialog>
  );
}
