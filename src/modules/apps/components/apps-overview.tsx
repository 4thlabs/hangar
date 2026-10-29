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
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { ComposeProjectsSnapshot, ComposeProjectSummary } from "#libs/docker";
import { AppsCategoryFilter } from "#modules/apps/components/apps-category-filter.tsx";
import { AppsStatusFilter } from "#modules/apps/components/apps-status-filter.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { AppsUpdateFilter } from "#modules/apps/components/apps-update-filter.tsx";
import { NewAppLink } from "#modules/apps/components/new-app-link.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { UninstalledToggle } from "#modules/apps/components/uninstalled-toggle.tsx";
import { filterProjects, nextSort, updateState } from "#modules/apps/filter.ts";
import { formatBytes, formatPercent } from "#modules/apps/format.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { useShowUninstalled } from "#modules/apps/hooks/use-show-uninstalled.ts";
import type { AppSortColumn, AppsSearch } from "#modules/apps/search-codec.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { countBy } from "#modules/common/count-by.ts";
import { useRouteRefresh } from "#modules/common/hooks/use-route-refresh.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type AppsOverviewProps = {
  /** The installed apps as Docker reports them, or `null` when the daemon could not be read. */
  snapshot: ComposeProjectsSnapshot | null;
  /** The store apps that are not installed, read from the store alone: listed even when Docker is down. */
  uninstalled: ComposeProjectSummary[];
  error: string | null;
  search: AppsSearch;
  /** Whether the store apps that are not installed are listed, as the server read the user's choice. */
  showUninstalled: boolean;
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

export function AppsOverview({ snapshot, uninstalled, error, search, showUninstalled }: AppsOverviewProps) {
  const { refresh, isRefreshing } = useRouteRefresh();
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const onSort = (column: AppSortColumn) => void setSearch({ sort: nextSort(search.sort, column) });
  const [uninstalledShown, setUninstalledShown] = useShowUninstalled(showUninstalled);
  // Docker knows only the installed apps: the cards, the status and the update filters count those alone.
  const projects = snapshot?.projects ?? [];
  const listed = uninstalledShown ? [...projects, ...uninstalled] : projects;
  const visible = filterProjects(listed, search);
  const counts = countBy(projects, project => project.status);
  const categoryCounts = countBy(listed, project => project.category?.name);
  const updateCounts = countBy(projects, updateState);

  const totals = projects.reduce(
    (result, project) => ({
      services: result.services + project.serviceCount,
      running: result.running + project.runningCount,
      stopped: result.stopped + project.containerIds.length - project.runningCount,
    }),
    { services: 0, running: 0, stopped: 0 },
  );

  return (
    <>
      <AutoReload />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">
            Les applications du store et l’état Docker de celles qui sont installées.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UninstalledToggle shown={uninstalledShown} count={uninstalled.length} onChange={setUninstalledShown} />
          <AppsUpdateFilter counts={updateCounts} />
          <AppsCategoryFilter counts={categoryCounts} />
          <AppsStatusFilter counts={counts} />
          <NewAppLink />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard title="Applications" value={projects.length} icon={BoxesIcon} />
          <StatCard title="Services" value={totals.services} icon={LayersIcon} />
          <StatCard title="Conteneurs actifs" value={totals.running} icon={PlayIcon} />
          <StatCard title="Conteneurs arrêtés" value={totals.stopped} icon={SquareIcon} />
          {/* Every installed app's containers at once: the stats stream covers the whole host, so
                the ids are what scopes the totals to Hangar's apps. */}
          <LiveTotals containerIds={projects.flatMap(project => project.containerIds)} />
        </div>
      )}

      {/* Without Docker, the apps not installed still list: installing one needs no daemon. */}
      {(snapshot || uninstalledShown) &&
        (visible.length > 0 ? (
          <AppsTable projects={visible} sort={search.sort} onSort={onSort} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpenIcon />
              </EmptyMedia>
              {listed.length === 0 ? (
                <>
                  <EmptyTitle>Aucune application installée</EmptyTitle>
                  <EmptyDescription>
                    Affichez les applications non installées pour en installer une, ou créez-en une nouvelle.
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
        ))}
    </>
  );
}
