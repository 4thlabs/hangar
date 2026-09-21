import { Suspense, type ReactNode } from "react";

type WarmProps = {
  /** Whether {@link children} can render without awaiting anything. */
  ready: boolean;
  /** Shown while a cold child loads. */
  fallback: ReactNode;
  children: ReactNode;
};

/**
 * Puts a Suspense boundary around `children` only when they are going to need one.
 *
 * This is the whole payoff of a synchronous `peek`. A component that awaits suspends, and a
 * suspended boundary puts its fallback in the shell however fast the promise settles — so a warm
 * cache alone only buys a quicker swap, not the absence of one. Not creating the boundary is what
 * stops the spinner existing; wrapping a warm child "just in case" gives it back.
 *
 * `ready` is the caller's peek, not ours: what counts as warm differs per page, and the child has
 * to be the one to serve it. This only decides the boundary.
 *
 * The key belongs on the `<Warm>` element at the call site, not inside here — see `apps.tsx`,
 * where it is what stops Waku's unkeyed route slot reusing this boundary for the detail page.
 */
export function Warm({ ready, fallback, children }: WarmProps) {
  return ready ? children : <Suspense fallback={fallback}>{children}</Suspense>;
}
