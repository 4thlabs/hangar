"use client";

import { useEffect, useRef } from "react";
import { CommandStream } from "#modules/common/command-stream.ts";
import { useStreamText } from "#modules/common/hooks/use-stream-text.ts";

/**
 * Runs a command stream route (`POST`) and follows its output, calling `onFinished` once it ends.
 * @param endpoint The route to run, `null` to stay idle
 * @param onFinished Called once per run, with the stream's exit code (`null` if the stream broke)
 */
export function useCommandStream(endpoint: string | null, onFinished: (code: number | null) => void) {
  const stream = useStreamText(endpoint, "POST");
  const { status, text } = stream;
  const finishedRef = useRef(false);

  useEffect(() => {
    if (status === "connecting" || status === "connected") {
      finishedRef.current = false;
    }

    if (finishedRef.current) {
      return;
    }

    if (status === "ended") {
      finishedRef.current = true;
      onFinished(CommandStream.exitCode(text));
    } else if (status === "error") {
      finishedRef.current = true;
      onFinished(null);
    }
  }, [onFinished, status, text]);

  return stream;
}
