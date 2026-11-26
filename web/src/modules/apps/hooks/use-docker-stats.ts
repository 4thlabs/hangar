import { useEffect, useState } from "react";
import { type ContainerMetrics, getDockerStatsUrl, ServerEvents, type StatsFrame } from "#libs/api";

/** The metrics of the running containers, by full container id. */
export type ContainerStats = StatsFrame["containers"];

/**
 * The live usage of the containers, a frame a second, totalled over `containerIds`; closed while the tab is hidden, and
 * never opened without a container: each frame costs the daemon a call per running container.
 */
export function useDockerStats(containerIds: readonly string[]) {
  const [stats, setStats] = useState<ContainerStats>({});
  const hasContainers = containerIds.length > 0;

  useEffect(() => {
    if (!hasContainers) {
      return;
    }

    let stop: (() => void) | undefined;

    const open = () => {
      stop ??= ServerEvents.follow<StatsFrame>(getDockerStatsUrl(), { onItem: frame => setStats(frame.containers) });
    };

    const close = () => {
      stop?.();
      stop = undefined;
    };

    const sync = () => (document.hidden ? close() : open());

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      close();
    };
  }, [hasContainers]);

  /** The sum of `pick` over the containers that have a reading; `null` when none has. */
  const total = (pick: (metrics: ContainerMetrics) => number | null) => {
    const readings = containerIds
      .map(id => stats[id])
      .filter(metrics => metrics !== undefined)
      .map(pick)
      .filter(value => value !== null);

    return readings.length > 0 ? readings.reduce((sum, value) => sum + value, 0) : null;
  };

  return { stats, total };
}
