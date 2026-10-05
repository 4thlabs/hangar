import type { ReactNode } from "react";
import type { Snapshot } from "#libs/cache";

/**
 * Renders a snapshot synchronously when it is warm, and only awaits it when it is cold.
 *
 * The other half of `Warm`: that one leaves the Suspense boundary out for a warm child, this
 * is what makes the child actually warm. An async component suspends however fast its promise
 * settles, so the warm path must not await anything — returning a promise only on the cold path is
 * what keeps a warm page from painting its fallback at all.
 *
 * @param show Renders the data; called on both paths, so they cannot render differently
 * @param onError Renders a failed load in place, rather than letting the route error boundary take
 * the whole page down. Only load errors reach it: `show` is not wrapped.
 */
export function renderSnapshot<T>(
  snapshot: Snapshot<T>,
  show: (data: T) => ReactNode,
  onError: (error: unknown) => ReactNode,
): ReactNode | Promise<ReactNode> {
  const ready = snapshot.peek();

  if (ready) {
    return show(ready.data);
  }

  return readThenShow(snapshot, show, onError);
}

/** The cold path: waits for the source, inside the caller's boundary. */
async function readThenShow<T>(
  snapshot: Snapshot<T>,
  show: (data: T) => ReactNode,
  onError: (error: unknown) => ReactNode,
): Promise<ReactNode> {
  let data: T;

  try {
    data = await snapshot.read();
  } catch (error: unknown) {
    return onError(error);
  }

  return show(data);
}
