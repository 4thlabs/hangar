"use client";

import { useState, useTransition } from "react";
import type { ReadResult } from "#modules/common/actions/action-result.ts";
import { TRANSPORT_ERROR_MESSAGE } from "#modules/common/components/action-toast.ts";

/**
 * Reads a value through a server action on demand, into local state, for a panel that shows it inline
 * rather than in a toast: the value once read, or why it could not be.
 */
export function useServerRead<T>() {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();

  const load = (read: () => Promise<ReadResult<T>>) =>
    startLoading(async () => {
      try {
        const result = await read();

        setValue(result.success ? result.value : null);
        setError(result.success ? null : result.message);
      } catch (cause) {
        // The panel only says the request failed; the cause is for whoever opens the console.
        console.error("Server action failed", cause);
        setError(TRANSPORT_ERROR_MESSAGE);
      }
    });

  /** Forgets the value and the error, as when the panel closes. */
  const reset = () => {
    setValue(null);
    setError(null);
  };

  return { value, error, isLoading, load, reset };
}
