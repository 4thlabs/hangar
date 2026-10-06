import { Suspense, type ReactNode } from "react";

type WarmProps = {
  /** Whether {@link children} can render without awaiting anything. */
  ready: boolean;
  /** Shown while a cold child loads. */
  fallback: ReactNode;
  children: ReactNode;
};

/**
 * Wraps children in Suspense only when not `ready`: a boundary around a warm child still flashes its fallback.
 * Key `<Warm>` at the call site, or Waku's unkeyed route slot reuses one boundary across routes.
 */
export function Warm({ ready, fallback, children }: WarmProps) {
  return ready ? children : <Suspense fallback={fallback}>{children}</Suspense>;
}
