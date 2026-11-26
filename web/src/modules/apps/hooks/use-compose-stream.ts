import { useQueryClient } from "@tanstack/react-query";
import {
  getComposeOutputUrl,
  getComposeRunUrl,
  type ComposeBatch,
  type ComposeEvent,
  type ComposeRequest,
} from "#libs/api";
import { composeQueries } from "#modules/apps/api/compose-queries.ts";
import {
  applyComposeEvents,
  emptyComposeOutput,
  type ComposeOutputState,
} from "#modules/apps/helpers/compose-output.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useEventStream, type StreamStatus } from "#modules/common/hooks/use-event-stream.ts";

/** What the panel says of a stream that ended before its `end`. */
const cutShortMessage = "The output was cut short: the command goes on on the server.";

/** Where the stream of a batch's output is. */
export type ComposeStreamStatus = StreamStatus;

/**
 * The output of one batch at a time: one this page starts, or one the server runs already, read again from its start.
 * A batch is started by `start`, from a click, never from an effect, which StrictMode runs twice: each call is a batch
 * on the server. Closing the stream, by `stop` or as the component goes, stops nothing there; one cut before its `end`
 * goes on there all the same, and the listing says how it ends.
 */
export function useComposeStream() {
  const queryClient = useQueryClient();
  // A batch this page started is listed once its stream opens, for the page to show it again once the panel is closed,
  // and its end once it ends.
  const readBatchesAgain = () => void queryClient.invalidateQueries({ queryKey: composeQueries.batches().queryKey });

  const stream = useEventStream<ComposeEvent, ComposeOutputState>(() => emptyComposeOutput([]), {
    // The lines come in bursts, as an image's layers are pulled, and the output keeps a bounded number of them.
    fold: applyComposeEvents,
    isEnd: event => event.kind === "end",
    requiresEnd: true,
    onOpen: readBatchesAgain,
    onEnd: readBatchesAgain,
  });

  const { status, failure } = stream;
  const isFailed = status === "error";

  return {
    output: stream.state,
    status,
    error: isFailed ? (failure === null ? cutShortMessage : describeError(failure)) : null,
    /** Starts a batch of `request`, and reads its output, laid out once its first event, the batch, says its apps' order. */
    start: (request: ComposeRequest) =>
      stream.read(getComposeRunUrl(), emptyComposeOutput([]), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    /** Reads the output of `batch`, which runs already, from its start. */
    follow: (batch: ComposeBatch) => stream.read(getComposeOutputUrl(batch.id), emptyComposeOutput(batch.apps)),
    /** Stops reading: the batch goes on. */
    stop: stream.stop,
  };
}
