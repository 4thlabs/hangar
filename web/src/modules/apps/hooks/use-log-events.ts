import { useEffect, useState } from "react";
import { type LogEvent, ServerEvents } from "#libs/api";
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
    setLines([]);
    setStatus("connecting");
    setError(null);

    return ServerEvents.read<LogEvent>(url, {
      onOpen: () => setStatus("connected"),
      onItem: event => {
        if (event.kind === "end") {
          setStatus("ended");

          return;
        }

        setLines(current => [...current, event.line].slice(-LogLines.Max));
      },
      onEnd: failure => {
        if (failure === undefined) {
          setStatus(current => (current === "error" ? current : "ended"));

          return;
        }

        setStatus("error");
        setError(ErrorMessage.describe(failure));
      },
    });
  }, [url, generation]);

  return {
    lines,
    status,
    error,
    clear: () => setLines([]),
    reconnect: () => setGeneration(current => current + 1),
  };
}
