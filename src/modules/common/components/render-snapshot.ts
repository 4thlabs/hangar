import type { ReactNode } from "react";
import type { Snapshot } from "#libs/cache";

/**
 * Renders synchronously when warm, awaits only when cold: an async component suspends however fast it settles.
 * `onError` renders a failed load in place and handles load errors only; `show` is not wrapped.
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
