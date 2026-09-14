"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DockerApiResult } from "#libs/docker";

const DEFAULT_INTERVAL = 5_000;

type DockerPollingState<T> = {
  data: T | null;
  error: string | null;
  isRefreshing: boolean;
  isStale: boolean;
};

type PollingOptions = {
  /**
   * Whether to poll on mount rather than waiting out the first interval. Pass `false` when the
   * server already rendered a complete snapshot, or the page fetches the same thing twice.
   */
  immediate?: boolean;
  interval?: number;
};

export function useDockerPolling<T>(endpoint: string, initialData: T | null, options: PollingOptions = {}) {
  const { immediate = true, interval = DEFAULT_INTERVAL } = options;
  const [state, setState] = useState<DockerPollingState<T>>({
    data: initialData,
    error: null,
    isRefreshing: false,
    isStale: false,
  });
  const requestRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (requestRef.current) return requestRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    setState(current => ({ ...current, isRefreshing: true }));

    const request = fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async response => {
        const result = (await response.json()) as DockerApiResult<T>;

        if (!response.ok || !result.success) {
          throw new Error(result.success ? `Request failed (${response.status})` : result.error.message);
        }

        setState({ data: result.data, error: null, isRefreshing: false, isStale: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setState(current => ({
          ...current,
          error: error instanceof Error ? error.message : "Impossible d’actualiser les données Docker.",
          isRefreshing: false,
          isStale: current.data !== null,
        }));
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        requestRef.current = null;
      });

    requestRef.current = request;
    return request;
  }, [endpoint]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (!disposed) timer = setTimeout(poll, interval);
    };

    const poll = async () => {
      if (!document.hidden) await refresh();
      schedule();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };

    // `immediate` pages render without the costly parts (container metrics) server-side, and this
    // is what fills them in. The others already have a complete snapshot: just schedule the next.
    if (immediate) void poll();
    else schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestRef.current = null;
    };
  }, [immediate, interval, refresh]);

  return { ...state, refresh };
}
