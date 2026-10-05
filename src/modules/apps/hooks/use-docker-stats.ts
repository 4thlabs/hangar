"use client";

import { createContext, use, useEffect, useState } from "react";
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
 * The latest frame of the stats stream, published by `DockerStatsProvider`. Only the components
 * that read it re-render on a frame: the provider's children are elements its parent built, so
 * the page around the live cells is left alone.
 */
export const DockerStatsContext = createContext<ContainerStats>({});

/**
 * Subscribes to the live container statistics stream. Metrics are keyed by full container id and
 * cover the whole host. `EventSource` reconnects on its own, and carries the session cookie.
 *
 * Dropped while the tab is hidden, the way `AutoReload` skips its reload: one frame costs the
 * daemon a stats call per running container, every second, and a tab left open in the background
 * would go on paying that forever for a page nobody is looking at.
 *
 * Call it once, in `DockerStatsProvider`: the component holding it re-renders on every frame.
 *
 * @returns The latest frame, empty until the first one arrives, about a second in
 */
export function useDockerStatsStream() {
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

  return stats;
}

/**
 * One container's latest metrics, from the nearest `DockerStatsProvider`.
 * @param containerId The container's full id
 */
export function useContainerMetrics(containerId: string) {
  return use(DockerStatsContext)[containerId] ?? EMPTY_METRICS;
}

/**
 * Totals over the latest frame of the nearest `DockerStatsProvider`. The stream covers the whole
 * host, so `containerIds` is what scopes the totals to what the caller is showing — one app's
 * containers or every installed app's.
 * @param containerIds The containers the totals cover
 * @returns A totaliser over those ids that ignores the containers the stream has no sample for
 */
export function useDockerStatsTotal(containerIds: readonly string[]) {
  const stats = use(DockerStatsContext);

  return (pick: (metrics: ContainerMetrics) => number | null) => {
    const available = containerIds.map(id => (stats[id] ? pick(stats[id]) : null)).filter(value => value !== null);

    return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
  };
}
