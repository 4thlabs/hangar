"use client";

import { SquareTerminalIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import { useSpotlightPlatform } from "#modules/spotlight/hooks/use-spotlight-platform.ts";
import { Spotlight } from "#modules/spotlight/spotlight.ts";
import { HostTerminal } from "#modules/terminal/host-terminal.ts";

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
 * session past a reload too. ⌘J or Ctrl+J opens and closes it from anywhere, the terminal itself included.
 */
export function HostTerminalDialog({ description, sshKey, children }: HostTerminalDialogProps) {
  const [open, setOpen] = useState(false);
  const [wasOpened, setWasOpened] = useState(false);
  const platform = useSpotlightPlatform();

  function handleOpenChange(next: boolean) {
    setOpen(next);

    if (next) {
      setWasOpened(true);
    }
  }

  useEffect(() => {
    const currentPlatform = Spotlight.platform(navigator.userAgent);

    function handleKeyDown(event: KeyboardEvent) {
      if (!Spotlight.matches(HostTerminal.Shortcut, event, currentPlatform, null)) {
        return;
      }

      event.preventDefault();
      setOpen(current => !current);
      setWasOpened(true);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={<DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Terminal" />} />}
        >
          <SquareTerminalIcon />
        </TooltipTrigger>
        <TooltipContent>Terminal ({Spotlight.label(HostTerminal.Shortcut, platform)})</TooltipContent>
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
