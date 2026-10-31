"use client";

import { CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";
import { Link } from "waku";
import type { ComposeProjectDetail } from "#libs/docker";
import { EditAppLink } from "#modules/apps/components/edit-app-link.tsx";
import { ProjectActions } from "#modules/apps/components/project-actions.tsx";
import { ServiceCard } from "#modules/apps/components/service-card.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { MetricFormat } from "#modules/apps/format.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import { statusVariant } from "#modules/apps/status.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** The resource and service cards; they own the stats subscription so a frame leaves the header alone. */
function AppLiveStats({ detail }: { detail: ComposeProjectDetail }) {
  const { stats, total } = useDockerStats(detail.containerIds);
  const { t, locale } = useTranslation(AppsMessages);
  const bytes = (value: number | null) => MetricFormat.bytes(value, locale);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("stats.cpu")}
          value={MetricFormat.percent(
            total(metrics => metrics.cpuPercent),
            locale,
          )}
          detail={t("stats.activeContainers")}
          icon={CpuIcon}
        />
        <StatCard
          title={t("stats.memory")}
          value={bytes(total(metrics => metrics.memoryUsage))}
          detail={t("stats.available", { amount: bytes(total(metrics => metrics.memoryLimit)) })}
          icon={MemoryStickIcon}
        />
        <StatCard
          title={t("stats.network")}
          value={`↓ ${bytes(total(metrics => metrics.networkRx))}`}
          detail={`↑ ${bytes(total(metrics => metrics.networkTx))}`}
          icon={NetworkIcon}
        />
        <StatCard
          title={t("stats.disk")}
          value={`↓ ${bytes(total(metrics => metrics.blockRead))}`}
          detail={`↑ ${bytes(total(metrics => metrics.blockWrite))}`}
          icon={HardDriveIcon}
        />
      </div>

      <div className="flex flex-col gap-4">
        {detail.services.map(service => (
          <ServiceCard key={service.name} project={detail.name} service={service} stats={stats} />
        ))}
      </div>
    </>
  );
}

export function AppDetail({ detail }: { detail: ComposeProjectDetail }) {
  const { t } = useTranslation(AppsMessages);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="link" className="w-fit px-0" render={<Link to="/apps">{t("allApps")}</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            <Badge variant={statusVariant(detail.status)}>{t(`status.${detail.status}`)}</Badge>
            {detail.updateAvailable && <Badge variant="outline">{t("updateAvailable")}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("detailSummary", {
              services: detail.serviceCount,
              running: detail.runningCount,
              containers: detail.containerIds.length,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditAppLink app={detail.name} />
          <ProjectActions project={detail.name} />
        </div>
      </div>

      <AppLiveStats detail={detail} />

      <AutoReload />
    </>
  );
}
