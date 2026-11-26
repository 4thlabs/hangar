import { useEffect, useState } from "react";
import { ServerEvents, type LogEvent } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";

/** Where a followed log is. */
export type LogStatus = "connecting" | "connected" | "ended" | "error";

/** The lines of a followed log the page keeps. */
class LogLines {
  /** The most lines kept: a log followed for hours would otherwise grow without end. */
  static readonly Max = 5_000;
}

/**
 * The log `url` streams, its last 200 lines then each new one, until the container stops. Read again from its tail by
 * `reconnect`; stopped when the component goes.
 */
export function useLogEvents(url: string) {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<LogStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  // Bumped to read the log again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    // The lines come in bursts, the first 200 at once: they are kept once a frame, not copied once a line.
    let pending: string[] = [];
    let frame: number | undefined;

    const flush = () => {
      const added = pending;

      pending = [];
      frame = undefined;
      setLines(current => [...current, ...added].slice(-LogLines.Max));
    };

    const flushNow = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        flush();
      }
    };

    setLines([]);
    setStatus("connecting");
    setError(null);

    const stop = ServerEvents.read<LogEvent>(url, {
      onOpen: () => setStatus("connected"),
      onItem: event => {
        if (event.kind === "end") {
          flushNow();
          setStatus("ended");

          return;
        }

        pending.push(event.line);
        frame ??= requestAnimationFrame(flush);
      },
      onEnd: failure => {
        flushNow();

        if (failure === undefined) {
          setStatus(current => (current === "error" ? current : "ended"));

          return;
        }

        setStatus("error");
        setError(ErrorMessage.describe(failure));
      },
    });

    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }

      stop();
    };
  }, [url, generation]);

  return {
    lines,
    status,
    error,
    clear: () => setLines([]),
    reconnect: () => setGeneration(current => current + 1),
  };
}
