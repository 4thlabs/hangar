"use client";

import { useEffect, useRef, useState } from "react";
import { ApiResponse } from "#modules/common/api-response.ts";
import type { StreamStatus } from "#modules/common/hooks/use-stream-text.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import { TerminalOutbox } from "#modules/common/terminal-outbox.ts";
import { TerminalProtocol, type TerminalMessage } from "#modules/common/terminal-protocol.ts";
import { TerminalView } from "#modules/common/terminal-view.ts";

/**
 * A terminal in the returned element, wired to a shell the endpoint opens: its output streamed in, the
 * keystrokes and resizes posted to the session. Unmounting, or `reconnect`, leaves the session: the route
 * decides whether it ends then (a container's) or waits for the next client (the host's).
 * @param endpoint The route opening the shell (`POST`, with the terminal's size)
 */
export function useTerminal(endpoint: string) {
  // Read at failure time, not a dependency: switching language must not reopen the session.
  const { t } = useTranslation(CommonMessages);
  const elementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the effect to open a new session.
  const [generation, setGeneration] = useState(0);
  // Where the session open now takes its messages; `close` ends it there.
  const sessionEndpointRef = useRef<string | null>(null);

  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    function fail(reason: unknown) {
      if (signal.aborted) {
        return;
      }

      setStatus("error");
      setError(reason instanceof Error ? reason.message : t("terminal.interrupted"));
    }

    async function post(url: string, body: unknown): Promise<Response> {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    }

    async function send(sessionEndpoint: string, message: TerminalMessage) {
      try {
        const response = await post(sessionEndpoint, message);

        if (!response.ok) {
          fail(await ApiResponse.error(response, t("terminal.inputLost")));
        }
      } catch (reason) {
        fail(reason);
      }
    }

    async function connect(container: HTMLDivElement) {
      setStatus("connecting");
      setError(null);

      const terminal = await TerminalView.open(container, signal);

      if (!terminal) {
        return;
      }

      const openedSize = { cols: terminal.cols, rows: terminal.rows };
      const response = await post(endpoint, openedSize);

      if (!response.ok) {
        throw await ApiResponse.error(response, t("terminal.openFailed"));
      }

      const id = response.headers.get(TerminalProtocol.IdHeader);

      if (!id || !response.body) {
        throw new Error(t("terminal.noSession"));
      }

      // Absent or malformed, nothing is held back: the terminal's own input stays on.
      const replayedBytes = Number(response.headers.get(TerminalProtocol.ReplayHeader)) || 0;
      const sessionEndpoint = TerminalProtocol.sessionEndpoint(id);

      sessionEndpointRef.current = sessionEndpoint;

      const outbox = new TerminalOutbox(message => send(sessionEndpoint, message));
      const typing = terminal.onData(data => outbox.type(data));
      const resizing = terminal.onResize(size => outbox.resize(size));

      if (terminal.cols !== openedSize.cols || terminal.rows !== openedSize.rows) {
        outbox.resize({ cols: terminal.cols, rows: terminal.rows });
      }

      terminal.focus();
      setStatus("connected");
      await TerminalView.follow(terminal, response.body, signal, replayedBytes);
      // The shell is gone: what is typed from now on has no session to go to.
      typing.dispose();
      resizing.dispose();
      sessionEndpointRef.current = null;

      if (!signal.aborted) {
        setStatus("ended");
      }
    }

    connect(element).catch(fail);

    return () => {
      controller.abort();
      sessionEndpointRef.current = null;
    };
  }, [endpoint, generation]);

  /** Ends the session and its shell; its output then ends, which the status shows. */
  async function close() {
    const sessionEndpoint = sessionEndpointRef.current;

    if (!sessionEndpoint) {
      return;
    }

    try {
      const response = await fetch(sessionEndpoint, { method: "DELETE" });

      if (!response.ok) {
        setError((await ApiResponse.error(response, t("terminal.closeFailed"))).message);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("terminal.closeFailed"));
    }
  }

  return {
    elementRef,
    status,
    error,
    /** Leaves the session and opens the terminal again: the same session when the route keeps it */
    reconnect: () => setGeneration(current => current + 1),
    close,
  };
}
