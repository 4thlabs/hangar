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
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { AppsCategoryFilter } from "#modules/apps/components/apps-category-filter.tsx";
import { AppsStatusFilter } from "#modules/apps/components/apps-status-filter.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { AppsUpdateFilter } from "#modules/apps/components/apps-update-filter.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { filterProjects, nextSort, updateState } from "#modules/apps/filter.ts";
import { MetricFormat } from "#modules/apps/format.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import type { AppSortColumn, AppsSearch } from "#modules/apps/search-codec.ts";
import { AutoReload } from "#modules/common/components/auto-reload.tsx";
import { countBy } from "#modules/common/count-by.ts";
import { useRouteRefresh } from "#modules/common/hooks/use-route-refresh.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
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
  const { t, locale } = useTranslation(AppsMessages);

  return (
    <>
      <StatCard
        title={t("stats.cpu")}
        value={MetricFormat.percent(
          total(metrics => metrics.cpuPercent),
          locale,
        )}
        detail={t("stats.allApps")}
        icon={CpuIcon}
      />
      <StatCard
        title={t("stats.memory")}
        value={MetricFormat.bytes(
          total(metrics => metrics.memoryUsage),
          locale,
        )}
        detail={t("stats.allApps")}
        icon={MemoryStickIcon}
      />
    </>
  );
}

export function AppsOverview({ snapshot, error, search }: AppsOverviewProps) {
  const { refresh, isRefreshing } = useRouteRefresh();
  const { t } = useTranslation(AppsMessages);
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

  return (
    <>
      <AutoReload />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppsUpdateFilter counts={updateCounts} />
          <AppsCategoryFilter counts={categoryCounts} />
          <AppsStatusFilter counts={counts} />
          <Button type="button" variant="outline" disabled={isRefreshing} onClick={() => void refresh()}>
            {isRefreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("dockerUnavailable")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              {t("retry")}
            </Button>
          </AlertAction>
        </Alert>
      )}

      {snapshot && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard title={t("stats.apps")} value={projects.length} icon={BoxesIcon} />
            <StatCard title={t("stats.services")} value={totals.services} icon={LayersIcon} />
            <StatCard title={t("stats.running")} value={totals.running} icon={PlayIcon} />
            <StatCard title={t("stats.stopped")} value={totals.stopped} icon={SquareIcon} />
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
                    <EmptyTitle>{t("empty.noAppsTitle")}</EmptyTitle>
                    <EmptyDescription>{t("empty.noAppsDescription")}</EmptyDescription>
                  </>
                ) : (
                  <>
                    <EmptyTitle>{t("empty.noResultsTitle")}</EmptyTitle>
                    <EmptyDescription>{t("empty.noResultsDescription")}</EmptyDescription>
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
