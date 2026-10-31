"use client";

import { useState, useTransition } from "react";
import type { ReadResult } from "#modules/common/actions/action-result.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";

/**
 * Reads a value through a server action on demand, into local state, for a panel that shows it inline
 * rather than in a toast: the value once read, or why it could not be.
 */
export function useServerRead<T>() {
  const { t } = useTranslation(CommonMessages);
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
        setError(t("actions.transportError"));
      }
    });

  /** Forgets the value and the error, as when the panel closes. */
  const reset = () => {
    setValue(null);
    setError(null);
  };

  return { value, error, isLoading, load, reset };
}
