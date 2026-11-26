import { useState } from "react";
import { getDockerStatsUrl, type ContainerMetrics, type StatsFrame } from "#libs/api";
import { useEventFeed } from "#modules/common/hooks/use-event-feed.ts";

/** The metrics of the running containers, by full container id. */
export type ContainerStats = StatsFrame["containers"];

/**
 * The live usage of the containers, a frame a second, totalled over `containerIds`; closed while the tab is hidden,
 * never opened without a container, as each frame costs the daemon a call per running container, and connected again
 * when it is lost, its figures cleared meanwhile rather than left as they were. The frames are no server state a query
 * holds: they stay here.
 */
export function useDockerStats(containerIds: readonly string[]) {
  const [stats, setStats] = useState<ContainerStats>({});

  useEventFeed<StatsFrame>(containerIds.length > 0 ? getDockerStatsUrl() : null, {
    onItem: frame => setStats(frame.containers),
    onDown: () => setStats({}),
    // Hidden, the figures would grow old: the tab shown again starts from none until its first frame.
    onClose: () => setStats({}),
  });

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
