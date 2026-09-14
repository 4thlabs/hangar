"use client";

import { useState } from "react";
import {
  BoxesIcon,
  CpuIcon,
  LayersIcon,
  MemoryStickIcon,
  PackageOpenIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { useRouter } from "waku";
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { ActionResult } from "#app/actions/action-result.ts";
import type { AppOperation } from "#app/actions/apps/app-operation.ts";
import { AppsStatusFilter } from "#app/components/apps/apps-status-filter.tsx";
import { AppsTable } from "#app/components/apps/apps-table.tsx";
import { filterProjects, nextSort, statusCounts } from "#app/components/apps/filter.ts";
import { formatBytes, formatPercent } from "#app/components/apps/format.ts";
import { StatCard } from "#app/components/apps/stat-card.tsx";
import { AutoReload } from "#app/components/common/auto-reload.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#app/components/ui/empty.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useDockerStats } from "#app/hooks/use-docker-stats.ts";
import type { AppSortColumn, AppsSearch } from "#app/search-codecs.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker/projects.ts";

type AppsOverviewProps = {
  snapshot: ComposeProjectsSnapshot | null;
  error: string | null;
  manageApp?: ((project: string, operation: AppOperation) => Promise<ActionResult>) | undefined;
  search: AppsSearch;
};

export function AppsOverview({ snapshot, error, manageApp, search }: AppsOverviewProps) {
  const router = useRouter();
  const [isRefreshing, setRefreshing] = useState(false);
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const onSort = (column: AppSortColumn) => void setSearch({ sort: nextSort(search.sort, column) });
  const projects = snapshot?.projects ?? [];
  const visible = filterProjects(projects, search);
  const counts = statusCounts(projects);
  const totals = projects.reduce(
    (result, project) => ({
      services: result.services + project.serviceCount,
      running: result.running + project.runningCount,
      stopped: result.stopped + project.stoppedCount,
    }),
    { services: 0, running: 0, stopped: 0 },
  );
  // Every installed app's containers at once: the stats stream covers the whole host, so the
  // ids are what scopes the totals to Hangar's apps.
  const { total } = useDockerStats(projects.flatMap(project => project.containerIds));

  async function refresh() {
    setRefreshing(true);
    try {
      await router.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <AutoReload />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">Applications installées par Hangar et leur état Docker.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppsStatusFilter counts={counts} />
          <Button type="button" variant="outline" disabled={isRefreshing} onClick={() => void refresh()}>
            {isRefreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Docker indisponible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </AlertAction>
        </Alert>
      )}

      {snapshot && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard title="Applications" value={projects.length} icon={BoxesIcon} />
            <StatCard title="Services" value={totals.services} icon={LayersIcon} />
            <StatCard title="Conteneurs actifs" value={totals.running} icon={PlayIcon} />
            <StatCard title="Conteneurs arrêtés" value={totals.stopped} icon={SquareIcon} />
            <StatCard
              title="CPU"
              value={formatPercent(total(metrics => metrics.cpuPercent))}
              detail="Toutes apps confondues"
              icon={CpuIcon}
            />
            <StatCard
              title="Mémoire"
              value={formatBytes(total(metrics => metrics.memoryUsage))}
              detail="Toutes apps confondues"
              icon={MemoryStickIcon}
            />
          </div>

          {visible.length > 0 ? (
            <AppsTable projects={visible} manageApp={manageApp} sort={search.sort} onSort={onSort} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageOpenIcon />
                </EmptyMedia>
                {projects.length === 0 ? (
                  <>
                    <EmptyTitle>Aucune application installée</EmptyTitle>
                    <EmptyDescription>
                      Installez une application depuis le store pour la retrouver ici.
                    </EmptyDescription>
                  </>
                ) : (
                  <>
                    <EmptyTitle>Aucun résultat</EmptyTitle>
                    <EmptyDescription>Aucune application ne correspond à cette recherche.</EmptyDescription>
                  </>
                )}
              </EmptyHeader>
            </Empty>
          )}
        </>
      )}
    </>
  );
}
