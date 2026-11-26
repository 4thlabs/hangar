import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readEvents } from "#libs/api";

/**
 * Where a stream that ends is: `connecting` until its answer opens it, and before any read; `ended` once its end came,
 * or once it closed without one when none is required; `error` once it failed, or closed before an end it requires.
 */
export type StreamStatus = "connecting" | "connected" | "ended" | "error";

/** How a stream's items make its state, and what it is told. */
export type StreamOptions<T, S> = {
  /** The state after `items`, which came in that order, from `state`. Called once a frame at most, not once an item. */
  fold: (state: S, items: readonly T[]) => S;
  /** Whether `item` is the stream's last, which the server sends as it ends it. */
  isEnd: (item: T) => boolean;
  /** Whether a stream that closes without its end failed, its work cut short: a command's output, not a log's. */
  requiresEnd?: boolean;
  /** The stream is open: the server answered. */
  onOpen?: () => void;
  /** The stream's end came. */
  onEnd?: () => void;
};

/** The most items that wait for a frame before they are folded all the same: a hidden tab runs no frame. */
const maxWaiting = 500;

/**
 * Reads `Events` streams that end, one at a time, with `readEvents`: a log followed to its container's end, a command's
 * output. Each item is folded into the state, which is rendered once a frame, not once an item, as the items come in
 * bursts. Nothing connects again: a stream that is lost has `error` as its status, with its `failure`, and `read`
 * starts it over. Closing a stream, by `stop`, by another `read` or as the component goes, stops nothing on the server.
 *
 * `read` is called from a click or an effect, never from a render. The options are the latest render's.
 *
 * @param initial The state before any read.
 * @returns The state, its setter (to clear it), the status, why the stream failed (`null` for a stream cut short
 *   before its end, or none failed), `read(url, seed, request?)`, which reads the stream at `url` from `seed`, a `GET`
 *   unless `request` says otherwise, and `stop`.
 */
export function useEventStream<T, S>(initial: S | (() => S), options: StreamOptions<T, S>) {
  const [state, setState] = useState(initial);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [failure, setFailure] = useState<unknown>(null);
  const latest = useRef(options);
  const stopCurrent = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    latest.current = options;
  });

  // Kept the same from render to render, as the effects that read a stream list them.
  const read = useCallback((url: string, seed: S, request: RequestInit = {}) => {
    stopCurrent.current();

    let folded = seed;
    let waiting: T[] = [];
    let frame: number | undefined;
    let hasEnded = false;

    const foldWaiting = () => {
      if (waiting.length > 0) {
        folded = latest.current.fold(folded, waiting);
        waiting = [];
      }
    };

    const render = () => {
      frame = undefined;
      foldWaiting();
      setState(folded);
    };

    const renderNow = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }

      render();
    };

    setState(seed);
    setStatus("connecting");
    setFailure(null);

    const stop = readEvents<T>(
      url,
      {
        onOpen: () => {
          setStatus("connected");
          latest.current.onOpen?.();
        },
        onItem: item => {
          waiting.push(item);

          if (latest.current.isEnd(item)) {
            hasEnded = true;
            renderNow();
            setStatus("ended");
            latest.current.onEnd?.();

            return;
          }

          if (waiting.length >= maxWaiting) {
            foldWaiting();
          }

          frame ??= requestAnimationFrame(render);
        },
        onEnd: error => {
          renderNow();

          if (hasEnded) {
            return;
          }

          if (error !== undefined) {
            setStatus("error");
            setFailure(error);

            return;
          }

          setStatus(latest.current.requiresEnd ? "error" : "ended");
        },
      },
      request,
    );

    stopCurrent.current = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }

      stop();
    };
  }, []);

  const stop = useCallback(() => {
    stopCurrent.current();
    stopCurrent.current = () => {};
  }, []);

  useEffect(() => stop, [stop]);

  return { state, setState, status, failure, read, stop };
}
