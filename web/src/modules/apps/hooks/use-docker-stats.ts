import { useEffect, useState } from "react";
import { getDockerStatsUrl, ServerEvents, type ContainerMetrics, type StatsFrame } from "#libs/api";

/** The metrics of the running containers, by full container id. */
export type ContainerStats = StatsFrame["containers"];

/**
 * The live usage of the containers, a frame a second, totalled over `containerIds`; closed while the tab is hidden,
 * never opened without a container, as each frame costs the daemon a call per running container, and connected again
 * when it is lost, its figures cleared meanwhile rather than left as they were.
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
      stop ??= ServerEvents.keep<StatsFrame>(getDockerStatsUrl(), {
        onItem: frame => setStats(frame.containers),
        onDown: () => setStats({}),
      });
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
