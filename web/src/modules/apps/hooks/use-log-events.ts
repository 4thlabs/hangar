import { useEffect, useState } from "react";
import type { LogEvent } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useEventStream, type StreamStatus } from "#modules/common/hooks/use-event-stream.ts";

/** Where a followed log is. */
export type LogStatus = StreamStatus;

/** The most lines of a followed log the page keeps: a log followed for hours would otherwise grow without end. */
const maxLogLines = 5_000;

/** `lines`, then the lines of `events`, the last `maxLogLines` of them. */
function withLines(lines: readonly string[], events: readonly LogEvent[]): readonly string[] {
  const added = events.flatMap(event => (event.kind === "line" ? [event.line] : []));

  return [...lines, ...added].slice(-maxLogLines);
}

/**
 * The log `url` streams, its last 200 lines then each new one, until the container stops. Read again from its tail by
 * `reconnect`, without the lines of the last read; stopped when the component goes.
 */
export function useLogEvents(url: string) {
  const {
    state: lines,
    setState: setLines,
    status,
    failure,
    read,
    stop,
  } = useEventStream<LogEvent, readonly string[]>([], { fold: withLines, isEnd: event => event.kind === "end" });

  // Bumped to read the log again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    read(url, []);

    return stop;
  }, [url, generation, read, stop]);

  return {
    lines,
    status,
    error: status === "error" && failure !== null ? describeError(failure) : null,
    clear: () => setLines([]),
    reconnect: () => setGeneration(current => current + 1),
  };
}
