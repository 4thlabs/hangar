"use client";

import { CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon, RefreshCwIcon } from "lucide-react";
import { Link } from "waku";
import { formatBytes, formatPercent } from "#app/components/apps/format.ts";
import { ProjectActions } from "#app/components/apps/project-actions.tsx";
import { ServiceCard } from "#app/components/apps/service-card.tsx";
import { StatCard } from "#app/components/apps/stat-card.tsx";
import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useDockerPolling } from "#app/hooks/use-docker-polling.ts";
import type { ComposeProjectDetail } from "#libs/docker";

type AppDetailProps = {
  initialData: ComposeProjectDetail;
};

const sumMetric = (values: Array<number | null>) => {
  const available = values.filter(value => value !== null);
  return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
};

export function AppDetail({ initialData }: AppDetailProps) {
  const endpoint = `/api/docker/apps/${encodeURIComponent(initialData.name)}`;
  const { data, error, isRefreshing, isStale, refresh } = useDockerPolling(endpoint, initialData);
  const project = data ?? initialData;
  const containers = project.services.flatMap(service => service.containers);
  const cpu = sumMetric(containers.map(container => container.metrics.cpuPercent));
  const memoryUsage = sumMetric(containers.map(container => container.metrics.memoryUsage));
  const memoryLimit = sumMetric(containers.map(container => container.metrics.memoryLimit));
  const networkRx = sumMetric(containers.map(container => container.metrics.networkRx));
  const networkTx = sumMetric(containers.map(container => container.metrics.networkTx));
  const blockRead = sumMetric(containers.map(container => container.metrics.blockRead));
  const blockWrite = sumMetric(containers.map(container => container.metrics.blockWrite));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="link" className="w-fit px-0" render={<Link to="/apps">← Toutes les apps</Link>} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <Badge variant={statusVariant(project.status)}>{statusLabel[project.status]}</Badge>
            {isRefreshing && <Spinner aria-label="Actualisation des statistiques" />}
          </div>
          <p className="text-sm text-muted-foreground">
            {project.serviceCount} service{project.serviceCount > 1 ? "s" : ""} · {project.runningCount}/
            {project.containerCount} conteneurs actifs
          </p>
        </div>
        <ProjectActions project={project.name} refresh={refresh} />
      </div>

      {error && (
        <Alert>
          <AlertTitle>{isStale ? "Données non actualisées" : "Erreur Docker"}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {project.partial && (
        <Alert>
          <AlertTitle>Échantillon partiel</AlertTitle>
          <AlertDescription>
            Certaines informations ont disparu ou n’ont pas pu être lues pendant cet échantillonnage.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="CPU" value={formatPercent(cpu)} detail="Somme des conteneurs actifs" icon={CpuIcon} />
        <StatCard
          title="Mémoire"
          value={formatBytes(memoryUsage)}
          detail={`${formatBytes(memoryLimit)} disponibles`}
          icon={MemoryStickIcon}
        />
        <StatCard
          title="Réseau"
          value={`↓ ${formatBytes(networkRx)}`}
          detail={`↑ ${formatBytes(networkTx)}`}
          icon={NetworkIcon}
        />
        <StatCard
          title="Disque"
          value={`↓ ${formatBytes(blockRead)}`}
          detail={`↑ ${formatBytes(blockWrite)}`}
          icon={HardDriveIcon}
        />
      </div>

      <div className="flex flex-col gap-4">
        {project.services.map(service => (
          <ServiceCard key={service.name} project={project.name} service={service} />
        ))}
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
        <RefreshCwIcon aria-hidden="true" />
        Actualisation automatique toutes les 5 secondes
      </p>
    </>
  );
}
