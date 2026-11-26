import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { staleAfterSync } from "#modules/settings/api/settings-queries.ts";

/**
 * Reads again what a sync may have changed once it ends, as the store's status, read each second while it runs, says
 * so: `isRunning` turning false, whichever page started it.
 */
export function useSyncEnd(isRunning: boolean) {
  const queryClient = useQueryClient();
  const wasRunning = useRef(false);

  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      for (const queryKey of staleAfterSync) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }

    wasRunning.current = isRunning;
  }, [isRunning, queryClient]);
}
