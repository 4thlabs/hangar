"use client";

import "@xterm/xterm/css/xterm.css";
import { StreamReconnectButton, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useTerminal } from "#modules/common/hooks/use-terminal.ts";

/**
 * A shell, filling the rest of its parent, a flex column; it closes when the panel unmounts. Loaded lazily
 * (see `ContainerConsoleSheet`), with xterm and its stylesheet.
 * @param endpoint The route opening the shell: a container's, or the host's
 */
export function TerminalPanel({ endpoint }: { endpoint: string }) {
  const { elementRef, status, error, reconnect } = useTerminal(endpoint);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StreamStatusBadge status={status} />
        <StreamReconnectButton status={status} onReconnect={reconnect} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {/*
        xterm draws inside the padding-free element it measures; the frame around it carries the padding.
        Absolute, so the rows drawn never stretch the frame they are fitted to: on a page, unlike in a sheet,
        nothing else bounds its height.
      */}
      <div className="relative min-h-48 flex-1 rounded-lg bg-muted">
        <div ref={elementRef} className="absolute inset-3" />
      </div>
    </>
  );
}
