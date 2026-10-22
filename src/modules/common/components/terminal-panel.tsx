"use client";

import "@xterm/xterm/css/xterm.css";
import { StreamReconnectButton, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useTerminal } from "#modules/common/hooks/use-terminal.ts";

/**
 * A shell, filling the rest of its parent, a flex column; it closes when the panel unmounts. Loaded lazily
 * (see `ContainerConsoleSheet`), with xterm and its stylesheet.
 * @param endpoint The route opening the shell
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
      {/* xterm draws inside the padding-free element it measures; the frame around it carries the padding. */}
      <div className="min-h-0 flex-1 rounded-lg bg-muted p-3">
        <div ref={elementRef} className="size-full" />
      </div>
    </>
  );
}
