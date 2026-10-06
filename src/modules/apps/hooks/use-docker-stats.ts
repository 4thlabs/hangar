"use client";

import { useEffect, useState } from "react";
import type { ContainerMetrics } from "#libs/docker";

export type ContainerStats = Record<string, ContainerMetrics>;

/** What a container reads as before its first frame arrives, or once it has stopped. */
export const EMPTY_METRICS: ContainerMetrics = {
  cpuPercent: null,
  memoryUsage: null,
  memoryLimit: null,
  memoryPercent: null,
  networkRx: null,
  networkTx: null,
  blockRead: null,
  blockWrite: null,
};

/**
 * Live stats over SSE, by container id, totalled over `containerIds`; closed while the tab is hidden.
 * Each frame costs the daemon a stats call per running container, every second.
 */
export function useDockerStats(containerIds: readonly string[]) {
  const [stats, setStats] = useState<ContainerStats>({});

  useEffect(() => {
    let source: EventSource | undefined;

    const open = () => {
      source ??= new EventSource("/api/docker/stats");
      source.onmessage = event => setStats(JSON.parse(event.data as string) as ContainerStats);
    };

    const close = () => {
      source?.close();
      source = undefined;
    };

    const sync = () => (document.hidden ? close() : open());

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      close();
    };
  }, []);

  const total = (pick: (metrics: ContainerMetrics) => number | null) => {
    const available = containerIds.map(id => (stats[id] ? pick(stats[id]) : null)).filter(value => value !== null);

    return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
  };

  return { stats, total };
}
