import { useEffect, useState } from "react";
import { readEvents, type LogEvent } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";

/** Where a followed log is. */
export type LogStatus = "connecting" | "connected" | "ended" | "error";

/** The most lines of a followed log the page keeps: a log followed for hours would otherwise grow without end. */
const maxLogLines = 5_000;

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
  // The read the state above belongs to. A new one starts empty, set during render rather than in the effect, so that
  // no frame shows the last read's lines under the new one.
  const read = `${generation} ${url}`;
  const [shownRead, setShownRead] = useState(read);

  if (shownRead !== read) {
    setShownRead(read);
    setLines([]);
    setStatus("connecting");
    setError(null);
  }

  useEffect(() => {
    // The lines come in bursts, the first 200 at once: they are kept once a frame, not copied once a line.
    let pending: string[] = [];
    let frame: number | undefined;

    const flush = () => {
      const added = pending;

      pending = [];
      frame = undefined;
      setLines(current => [...current, ...added].slice(-maxLogLines));
    };

    const flushNow = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        flush();
      }
    };

    const stop = readEvents<LogEvent>(url, {
      onOpen: () => setStatus("connected"),
      onItem: event => {
        if (event.kind === "end") {
          flushNow();
          setStatus("ended");

          return;
        }

        pending.push(event.line);

        // A hidden tab runs no frame, while the log goes on: what waits for one is bounded too, cut once in a while
        // rather than at each line.
        if (pending.length >= 2 * maxLogLines) {
          pending = pending.slice(-maxLogLines);
        }

        frame ??= requestAnimationFrame(flush);
      },
      onEnd: failure => {
        flushNow();

        if (failure === undefined) {
          setStatus(current => (current === "error" ? current : "ended"));

          return;
        }

        setStatus("error");
        setError(describeError(failure));
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
