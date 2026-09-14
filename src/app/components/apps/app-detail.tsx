"use client";

import { CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";
import { Link } from "waku";
import { formatBytes, formatPercent, s } from "#app/components/apps/format.ts";
import { ProjectActions } from "#app/components/apps/project-actions.tsx";
import { ServiceCard } from "#app/components/apps/service-card.tsx";
import { StatCard } from "#app/components/apps/stat-card.tsx";
import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { AutoReload } from "#app/components/common/auto-reload.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { useDockerStats } from "#app/hooks/use-docker-stats.ts";
import type { ComposeProjectDetail } from "#libs/docker/projects.ts";

export function AppDetail({ detail }: { detail: ComposeProjectDetail }) {
  const { stats, total } = useDockerStats(detail.containerIds);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="link" className="w-fit px-0" render={<Link to="/apps">← Toutes les apps</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            <Badge variant={statusVariant(detail.status)}>{statusLabel[detail.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.serviceCount} service{s(detail.serviceCount)} · {detail.runningCount}/{detail.containerCount}{" "}
            conteneurs actifs
          </p>
        </div>
        <ProjectActions project={detail.name} />
      </div>

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

      <div className="flex flex-col gap-4">
        {detail.services.map(service => (
          <ServiceCard key={service.name} project={detail.name} service={service} stats={stats} />
        ))}
      </div>

      <AutoReload />
    </>
  );
}
