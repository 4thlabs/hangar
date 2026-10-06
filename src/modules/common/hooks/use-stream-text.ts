"use client";

import { useEffect, useState } from "react";

const MAX_STREAM_CHARACTERS = 200_000;

export type StreamStatus = "idle" | "connecting" | "connected" | "ended" | "error";

export const streamStatusLabel: Record<StreamStatus, string> = {
  idle: "Inactif",
  connecting: "Connexion…",
  connected: "En direct",
  ended: "Flux terminé",
  error: "Erreur",
};

/**
 * Streams a chunked text endpoint (container logs, compose output), keeping the last {@link MAX_STREAM_CHARACTERS}.
 * A `null` endpoint stays idle; the request is aborted on unmount or endpoint change.
 */
export function useStreamText(endpoint: string | null, method: "GET" | "POST" = "GET") {
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
      setStatus("connecting");
      setError(null);

      try {
        const response = await fetch(url, { method, signal: controller.signal });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? "Impossible de charger le flux.");
        }
        if (!response.body) {
          throw new Error("Le serveur n’a retourné aucun flux.");
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
        setError(reason instanceof Error ? reason.message : "Le flux a été interrompu.");
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
