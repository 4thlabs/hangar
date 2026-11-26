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

/** What a follower of a stream kept open is told. */
export type KeptHandlers<T> = {
  /** Each event's data, parsed. */
  onItem: (item: T) => void;
  /** The stream is open, at first or again: what changed before it is not in it. */
  onOpen?: () => void;
  /** The stream was lost: it is connected again, and `onOpen` told once it is. */
  onDown?: () => void;
};

/**
 * Reads the `Events` routes of the server, its server-sent events: an item in the `data` of each event with no name,
 * and `event: problem` for a failure after the 200, which ends the stream. The page is served on the server's own
 * origin, so its session cookie goes with each request.
 */
export class ServerEvents {
  /** The wait before a stream closed for good is connected again, the first time, in milliseconds. */
  static readonly FirstWait = 1_000;

  /** The longest wait, after many failures in a row. */
  static readonly LongestWait = 30_000;

  /**
   * Follows a stream that does not end, until the function it returns is called, and connects it again however it was
   * lost: `EventSource` itself after a clean end or a network failure, and this after an answer that closes the source
   * for good, a 502 while the server restarts, a 401, or a problem, after a wait from a second, doubled by each
   * failure in a row up to 30 seconds.
   */
  static keep<T>(url: string, { onItem, onOpen = () => {}, onDown = () => {} }: KeptHandlers<T>): () => void {
    let wait = ServerEvents.FirstWait;
    let stop = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      stop = ServerEvents.follow<T>(url, {
        onItem,
        onOpen: () => {
          wait = ServerEvents.FirstWait;
          onOpen();
        },
        onDown,
        onEnd: () => {
          timer = setTimeout(connect, wait);
          wait = Math.min(wait * 2, ServerEvents.LongestWait);
        },
      });
    };

    connect();

    return () => {
      clearTimeout(timer);
      stop();
    };
  }

  /**
   * Follows a stream that does not end, with `EventSource`, until the function it returns is called; `onDown` is told
   * each time it is lost. After a clean end the source connects again on its own, and `onOpen` is told; any other
   * answer than a 200 closes it for good, as a 5xx of a proxy while the server restarts, which `onEnd` is told with no
   * error, as the source sees no status.
   */
  static follow<T>(
    url: string,
    {
      onItem,
      onOpen = () => {},
      onEnd = () => {},
      onDown = () => {},
    }: EventHandlers<T> & Pick<KeptHandlers<T>, "onDown">,
  ): () => void {
    const source = new EventSource(url);

    source.onopen = () => onOpen();
    source.onmessage = (event: MessageEvent<string>) => onItem(JSON.parse(event.data) as T);
    source.addEventListener("problem", (event: MessageEvent<string>) => {
      const problem = JSON.parse(event.data) as Problem;

      source.close();
      onDown();
      onEnd(new ApiError(problem.status ?? 500, problem));
    });

    // Whether the source tries again on its own or is closed for good, the stream is lost until it opens again.
    source.onerror = () => {
      onDown();

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
