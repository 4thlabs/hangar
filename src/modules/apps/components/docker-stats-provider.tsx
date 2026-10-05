"use client";

import type { ReactNode } from "react";
import { DockerStatsContext, useDockerStatsStream } from "#modules/apps/hooks/use-docker-stats.ts";

/**
 * Holds the stats stream and hands each frame to the components below that read it. Wrap the
 * live part of a page, not the page: this component re-renders every second, and only the
 * context readers under it follow.
 */
export function DockerStatsProvider({ children }: { children: ReactNode }) {
  const stats = useDockerStatsStream();

  return <DockerStatsContext value={stats}>{children}</DockerStatsContext>;
}
