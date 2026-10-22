"use client";

import { useSyncExternalStore } from "react";

/** The side a component renders on, as `useSyncExternalStore` reads it. */
class RenderSide {
  /** Nothing to listen to: whether the browser renders only changes once, at hydration. */
  static subscribe() {
    return () => {};
  }

  static inBrowser() {
    return true;
  }

  static onServer() {
    return false;
  }
}

/**
 * `false` on the server and during hydration, `true` once the browser renders: for what only the browser can
 * draw, without a hydration mismatch.
 */
export function useInBrowser(): boolean {
  return useSyncExternalStore(RenderSide.subscribe, RenderSide.inBrowser, RenderSide.onServer);
}
