"use client";

import { useEffect, useRef } from "react";

/**
 * A ref holding the latest `value`, for an effect that reads it when something happens rather than when it starts:
 * the effect sees the current value without listing it, and so without restarting when it changes.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}
