"use client";

import { CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";
import { Link } from "waku";
import { formatBytes, formatPercent, s } from "#modules/apps/format.ts";
import { DockerStatsProvider } from "#modules/apps/components/docker-stats-provider.tsx";
import { ProjectActions } from "#modules/apps/components/project-actions.tsx";
import { ServiceCard } from "#modules/apps/components/service-card.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { statusLabel, statusVariant } from "#modules/apps/status.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { useDockerStatsTotal } from "#modules/apps/hooks/use-docker-stats.ts";
import type { ComposeProjectDetail } from "#libs/docker";

/** The resource cards, summed over the app's containers from each stats frame. */
function LiveTotals({ containerIds }: { containerIds: readonly string[] }) {
  const total = useDockerStatsTotal(containerIds);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="CPU"
        value={formatPercent(total(metrics => metrics.cpuPercent))}
        detail="Somme des conteneurs actifs"
        icon={CpuIcon}
      />
      <StatCard
        title="Mémoire"
        value={formatBytes(total(metrics => metrics.memoryUsage))}
        detail={`${formatBytes(total(metrics => metrics.memoryLimit))} disponibles`}
        icon={MemoryStickIcon}
      />
      <StatCard
        title="Réseau"
        value={`↓ ${formatBytes(total(metrics => metrics.networkRx))}`}
        detail={`↑ ${formatBytes(total(metrics => metrics.networkTx))}`}
        icon={NetworkIcon}
      />
      <StatCard
        title="Disque"
        value={`↓ ${formatBytes(total(metrics => metrics.blockRead))}`}
        detail={`↑ ${formatBytes(total(metrics => metrics.blockWrite))}`}
        icon={HardDriveIcon}
      />
    </div>
  );
}

export function AppDetail({ detail }: { detail: ComposeProjectDetail }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="link" className="w-fit px-0" render={<Link to="/apps">← Toutes les apps</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            <Badge variant={statusVariant(detail.status)}>{statusLabel[detail.status]}</Badge>
            {detail.updateAvailable && <Badge variant="outline">Mise à jour disponible</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.serviceCount} service{s(detail.serviceCount)} · {detail.runningCount}/{detail.containerCount}{" "}
            conteneurs actifs
          </p>
        </div>
        <ProjectActions project={detail.name} />
      </div>

      <DockerStatsProvider>
        <LiveTotals containerIds={detail.containerIds} />

        <div className="flex flex-col gap-4">
          {detail.services.map(service => (
            <ServiceCard key={service.name} project={detail.name} service={service} />
          ))}
        </div>
      </DockerStatsProvider>

      <AutoReload />
    </>
  );
}
