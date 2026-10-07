"use client";

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
import { useState } from "react";
import { useRouter } from "waku";
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { AppsCategoryFilter } from "#modules/apps/components/apps-category-filter.tsx";
import { AppsStatusFilter } from "#modules/apps/components/apps-status-filter.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { AppsUpdateFilter } from "#modules/apps/components/apps-update-filter.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { filterProjects, nextSort, updateState } from "#modules/apps/filter.ts";
import { formatBytes, formatPercent } from "#modules/apps/format.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import type { AppSortColumn, AppsSearch } from "#modules/apps/search-codec.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { countBy } from "#modules/common/count-by.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type AppsOverviewProps = {
  snapshot: ComposeProjectsSnapshot | null;
  error: string | null;
  search: AppsSearch;
};

/** The CPU and memory cards; they own the stats subscription so a frame re-renders only them. */
function LiveTotals({ containerIds }: { containerIds: readonly string[] }) {
  const { total } = useDockerStats(containerIds);

  return (
    <>
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
    </>
  );
}

export function AppsOverview({ snapshot, error, search }: AppsOverviewProps) {
  const router = useRouter();
  const [isRefreshing, setRefreshing] = useState(false);
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const onSort = (column: AppSortColumn) => void setSearch({ sort: nextSort(search.sort, column) });
  const projects = snapshot?.projects ?? [];
  const visible = filterProjects(projects, search);
  const counts = countBy(projects, project => project.status);
  const categoryCounts = countBy(projects, project => project.category?.name);
  const updateCounts = countBy(projects, updateState);

  const totals = projects.reduce(
    (result, project) => ({
      services: result.services + project.serviceCount,
      running: result.running + project.runningCount,
      stopped: result.stopped + project.containerIds.length - project.runningCount,
    }),
    { services: 0, running: 0, stopped: 0 },
  );

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
          <AppsUpdateFilter counts={updateCounts} />
          <AppsCategoryFilter counts={categoryCounts} />
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
            {/* Every installed app's containers at once: the stats stream covers the whole host, so
                the ids are what scopes the totals to Hangar's apps. */}
            <LiveTotals containerIds={projects.flatMap(project => project.containerIds)} />
          </div>

          {visible.length > 0 ? (
            <AppsTable projects={visible} sort={search.sort} onSort={onSort} />
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
