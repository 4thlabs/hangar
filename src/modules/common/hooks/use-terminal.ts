"use client";

import { useEffect, useRef, useState } from "react";
import { ApiResponse } from "#modules/common/api-response.ts";
import type { StreamStatus } from "#modules/common/hooks/use-stream-text.ts";
import { TerminalOutbox } from "#modules/common/terminal-outbox.ts";
import { TerminalProtocol, type TerminalMessage } from "#modules/common/terminal-protocol.ts";
import { TerminalView } from "#modules/common/terminal-view.ts";

/**
 * A terminal in the returned element, wired to a shell the endpoint opens: its output streamed in, the
 * keystrokes and resizes posted to the session. Unmounting, or `reconnect`, closes the session.
 * @param endpoint The route opening the shell (`POST`, with the terminal's size)
 */
export function useTerminal(endpoint: string) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the effect to open a new session.
  const [generation, setGeneration] = useState(0);

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
      setError(reason instanceof Error ? reason.message : "Le terminal a été interrompu.");
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
          fail(await ApiResponse.error(response, "Le terminal n’a pas reçu la saisie."));
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
        throw await ApiResponse.error(response, "Impossible d’ouvrir le terminal.");
      }

      const id = response.headers.get(TerminalProtocol.IdHeader);

      if (!id || !response.body) {
        throw new Error("Le serveur n’a ouvert aucun terminal.");
      }

      const sessionEndpoint = TerminalProtocol.sessionEndpoint(id);
      const outbox = new TerminalOutbox(message => send(sessionEndpoint, message));
      const typing = terminal.onData(data => outbox.type(data));
      const resizing = terminal.onResize(size => outbox.resize(size));

      if (terminal.cols !== openedSize.cols || terminal.rows !== openedSize.rows) {
        outbox.resize({ cols: terminal.cols, rows: terminal.rows });
      }

      terminal.focus();
      setStatus("connected");
      await TerminalView.follow(terminal, response.body, signal);
      // The shell is gone: what is typed from now on has no session to go to.
      typing.dispose();
      resizing.dispose();

      if (!signal.aborted) {
        setStatus("ended");
      }
    }

    connect(element).catch(fail);

    return () => controller.abort();
  }, [endpoint, generation]);

  return {
    elementRef,
    status,
    error,
    /** Closes the session and opens a new one in a fresh terminal */
    reconnect: () => setGeneration(current => current + 1),
  };
}
