"use client";

import "@xterm/xterm/css/xterm.css";
import { XIcon } from "lucide-react";
import { StreamReconnectButton, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useTerminal } from "#modules/common/hooks/use-terminal.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";

type TerminalPanelProps = {
  /** The route opening the shell: a container's, or the host's */
  endpoint: string;
  /** Offers **Fermer la session** while connected: a container's sheet does, the host's dialog does not. */
  closable?: boolean;
};

/**
 * A shell, filling the rest of its parent, a flex column. Unmounting the panel leaves the session, which
 * ends then (a container's) or waits for the next client (the host's), as its route decides. Loaded lazily
 * (see `ContainerConsoleSheet`), with xterm and its stylesheet.
 */
export function TerminalPanel({ endpoint, closable = false }: TerminalPanelProps) {
  const { t } = useTranslation(CommonMessages);
  const { elementRef, status, error, reconnect, close } = useTerminal(endpoint);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StreamStatusBadge status={status} />
        <StreamReconnectButton status={status} onReconnect={reconnect} />
        {closable && status === "connected" && (
          <Button type="button" variant="outline" size="sm" onClick={() => void close()}>
            <XIcon data-icon="inline-start" />
            {t("terminal.close")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {/*
        xterm draws inside the padding-free element it measures; the frame around it carries the padding.
        Absolute, so the rows drawn never stretch the frame they are fitted to: in a dialog, unlike in a sheet,
        nothing else bounds its height.
      */}
      <div className="relative min-h-48 flex-1 rounded-lg bg-muted">
        <div ref={elementRef} className="absolute inset-3" />
      </div>
    </>
  );
}
