"use client";

import { useEffect, useState } from "react";
import { ApiResponse } from "#modules/common/api-response.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";

const MAX_STREAM_CHARACTERS = 200_000;

export type StreamStatus = "idle" | "connecting" | "connected" | "ended" | "error";

/**
 * Streams a chunked text endpoint (container logs, compose output), keeping the last {@link MAX_STREAM_CHARACTERS}.
 * A `null` endpoint stays idle and keeps the last text; the request is aborted on unmount or endpoint change.
 */
export function useStreamText(endpoint: string | null, method: "GET" | "POST" = "GET") {
  // Read at failure time, not a dependency: switching language must not restart the stream.
  const { t } = useTranslation(CommonMessages);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the effect to re-run the same request.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!endpoint) {
      return;
    }

    const controller = new AbortController();

    async function follow(url: string) {
      // Every request starts from scratch: the hook outlives its requests (the compose sheet stays
      // mounted between commands), and a new command's output would otherwise land after the last one's.
      setText("");
      setStatus("connecting");
      setError(null);

      try {
        const response = await fetch(url, { method, signal: controller.signal });

        if (!response.ok) {
          throw await ApiResponse.error(response, t("stream.loadFailed"));
        }

        if (!response.body) {
          throw new Error(t("stream.noBody"));
        }

        setStatus("connected");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });

          setText(current => `${current}${chunk}`.slice(-MAX_STREAM_CHARACTERS));
        }

        const remainder = decoder.decode();

        if (remainder) {
          setText(current => `${current}${remainder}`.slice(-MAX_STREAM_CHARACTERS));
        }

        if (!controller.signal.aborted) {
          setStatus("ended");
        }
      } catch (reason) {
        if (controller.signal.aborted) {
          return;
        }

        setStatus("error");
        setError(reason instanceof Error ? reason.message : t("stream.interrupted"));
      }
    }

    void follow(endpoint);

    return () => controller.abort();
  }, [endpoint, generation, method]);

  return {
    text,
    status,
    error,
    clear: () => setText(""),
    /** Clears the text and runs the request again */
    reconnect: () => {
      setText("");
      setGeneration(current => current + 1);
    },
  };
}
