import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getComposeBatchesQueryKey,
  getComposeOutputUrl,
  getComposeRunUrl,
  readEvents,
  type ComposeBatch,
  type ComposeEvent,
  type ComposeRequest,
} from "#libs/api";
import { ComposeOutput, type ComposeOutputState } from "#modules/apps/compose-output.ts";
import { describeError } from "#modules/common/error-message.ts";

/** What the panel says of its stream. */
class ComposeStreamText {
  /** A stream that ended before its `end`. */
  static readonly CutShort = "The output was cut short: the command goes on on the server.";
}

/** Where the stream of a batch's output is. */
export type ComposeStreamStatus = "connecting" | "connected" | "ended" | "error";

/**
 * The output of one batch at a time: one this page starts, or one the server runs already, read again from its start.
 * A batch is started by `start`, from a click, never from an effect, which StrictMode runs twice: each call is a batch
 * on the server. Closing the stream, by `stop` or as the component goes, stops nothing there.
 */
export function useComposeStream() {
  const queryClient = useQueryClient();
  const [output, setOutput] = useState<ComposeOutputState>(() => ComposeOutput.create([]));
  const [status, setStatus] = useState<ComposeStreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const read = useCallback(
    (url: string, apps: readonly string[], request: RequestInit = {}) => {
      stopRef.current();

      // The lines come in bursts, as an image's layers are pulled: each event is folded as it comes, which bounds the
      // lines kept even while a hidden tab runs no frame, and the output is rendered once a frame, not once a line.
      let folded = ComposeOutput.create(apps);
      let frame: number | undefined;
      let hasEnded = false;

      const render = () => {
        frame = undefined;
        setOutput(folded);
      };

      const renderNow = () => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
        }

        render();
      };

      setOutput(folded);
      setStatus("connecting");
      setError(null);

      const stop = readEvents<ComposeEvent>(
        url,
        {
          onOpen: () => {
            setStatus("connected");
            // A batch this page started is listed from now on, for the page to show it again once the panel is closed.
            void queryClient.invalidateQueries({ queryKey: getComposeBatchesQueryKey() });
          },
          onItem: event => {
            folded = ComposeOutput.apply(folded, [event]);

            if (event.kind !== "end") {
              frame ??= requestAnimationFrame(render);

              return;
            }

            hasEnded = true;
            renderNow();
            setStatus("ended");
            void queryClient.invalidateQueries({ queryKey: getComposeBatchesQueryKey() });
          },
          onEnd: failure => {
            renderNow();

            if (hasEnded) {
              return;
            }

            // Cut before its `end`, the batch goes on all the same: the listing says how it ends.
            setStatus("error");
            setError(failure === undefined ? ComposeStreamText.CutShort : describeError(failure));
          },
        },
        request,
      );

      stopRef.current = () => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
        }

        stop();
      };
    },
    [queryClient],
  );

  /** Starts a batch of `request`, and reads its output. */
  const start = useCallback(
    (request: ComposeRequest) =>
      // Laid out once its first event, the batch, says the order its apps run in.
      read(getComposeRunUrl(), [], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    [read],
  );

  /** Reads the output of `batch`, which runs already, from its start. */
  const follow = useCallback((batch: ComposeBatch) => read(getComposeOutputUrl(batch.id), batch.apps), [read]);

  /** Stops reading: the batch goes on. */
  const stop = useCallback(() => {
    stopRef.current();
    stopRef.current = () => {};
  }, []);

  useEffect(() => stop, [stop]);

  return { output, status, error, start, follow, stop };
}
