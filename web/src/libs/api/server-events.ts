import { ApiError } from "./api-fetch.ts";
import type { Problem } from "./generated.ts";

/** What a reader of an `Events` route is told. */
export type EventHandlers<T> = {
  /** Each event's data, parsed. */
  onItem: (item: T) => void;
  /** The stream is open, at first or again: what changed before it is not in it. */
  onOpen?: () => void;
  /** The stream ended without being asked to: the error of a failure, or nothing when the server ended it. */
  onEnd?: (error?: unknown) => void;
};

/**
 * Reads the `Events` routes of the server, its server-sent events: an item in the `data` of each event with no name,
 * and `event: problem` for a failure after the 200, which ends the stream. The page is served on the server's own
 * origin, so its session cookie goes with each request.
 */
export class ServerEvents {
  /**
   * Follows a stream that does not end, with `EventSource`, until the function it returns is called. After a clean
   * end the source connects again on its own, and `onOpen` is told; any other answer than a 200 closes it for good,
   * as a 5xx of a proxy while the server restarts, which `onEnd` is told with no error, as the source sees no status.
   */
  static follow<T>(url: string, { onItem, onOpen = () => {}, onEnd = () => {} }: EventHandlers<T>): () => void {
    const source = new EventSource(url);

    source.onopen = () => onOpen();
    source.onmessage = (event: MessageEvent<string>) => onItem(JSON.parse(event.data) as T);
    source.addEventListener("problem", (event: MessageEvent<string>) => {
      const problem = JSON.parse(event.data) as Problem;

      source.close();
      onEnd(new ApiError(problem.status ?? 500, problem));
    });

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        onEnd();
      }
    };

    return () => source.close();
  }

  /**
   * Reads a stream once, with `fetch`, until it ends or the function it returns is called: an answer that is not a
   * 200 is its `ApiError`, which `onEnd` is told, and nothing connects again.
   */
  static read<T>(url: string, { onItem, onOpen = () => {}, onEnd = () => {} }: EventHandlers<T>): () => void {
    const controller = new AbortController();

    function ended(error?: unknown) {
      if (!controller.signal.aborted) {
        onEnd(error);
      }
    }

    ServerEvents.readAll(url, onItem, onOpen, controller.signal).then(() => ended(), ended);

    return () => controller.abort();
  }

  private static async readAll<T>(url: string, onItem: (item: T) => void, onOpen: () => void, signal: AbortSignal) {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw await ApiError.read(response);
    }

    // A 204 or a 205 has no body: a stream that ends at once.
    if (response.body === null) {
      return;
    }

    onOpen();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      // A chunk may end within an event: its start waits in `buffer` for the next one.
      const blocks = (buffer + value).split("\n\n");

      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const { event, data } = ServerEvents.parse(block);

        if (data === undefined) {
          continue;
        }

        if (event === "problem") {
          const problem = JSON.parse(data) as Problem;

          throw new ApiError(problem.status ?? 500, problem);
        }

        onItem(JSON.parse(data) as T);
      }
    }
  }

  /** One event, its lines `field: value`; a line that starts with `:` is a comment. */
  private static parse(block: string): { event: string | undefined; data: string | undefined } {
    let event: string | undefined;
    let data: string | undefined;

    for (const line of block.split("\n")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");

      if (field === "event") {
        event = value;
      } else if (field === "data") {
        data = data === undefined ? value : `${data}\n${value}`;
      }
    }

    return { event, data };
  }
}
