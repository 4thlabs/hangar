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
 * Subscribes to the live container statistics stream. Metrics are keyed by full container id and
 * cover the whole host, so `containerIds` is what scopes the totals to what the caller is showing
 * — one app's containers or every installed app's. `EventSource` reconnects on its own, and
 * carries the session cookie.
 * @param containerIds The containers the caller's totals cover
 * @returns The latest frame (empty until the first one arrives, about a second in), and a
 * totaliser over those ids that ignores the containers the stream has no sample for
 */
export function useDockerStats(containerIds: readonly string[]) {
  const [stats, setStats] = useState<ContainerStats>({});

  useEffect(() => {
    const source = new EventSource("/api/docker/stats");

    source.onmessage = event => setStats(JSON.parse(event.data as string) as ContainerStats);

    return () => source.close();
  }, []);

  const total = (pick: (metrics: ContainerMetrics) => number | null) => {
    const available = containerIds.map(id => (stats[id] ? pick(stats[id]) : null)).filter(value => value !== null);

    return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
  };

  return { stats, total };
}
