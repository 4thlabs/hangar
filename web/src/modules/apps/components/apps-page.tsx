import { useNavigate, useSearch } from "@tanstack/react-router";
import { BoxesIcon, CpuIcon, LayersIcon, MemoryStickIcon, PackageOpenIcon, PlayIcon, SquareIcon } from "lucide-react";
import { type ProjectSummary, useDockerProjects } from "#libs/api";
import { AppsSearchParams, type AppSortColumn } from "#modules/apps/apps-search.ts";
import { AppsFilterMenus } from "#modules/apps/components/apps-filter-menus.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { useDockerChanges } from "#modules/apps/hooks/use-docker-changes.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { MetricFormat } from "#modules/apps/metric-format.ts";
import { ProjectFilter } from "#modules/apps/project-filter.ts";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { TableSort } from "#modules/common/table-sort.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";

/** The CPU and memory of every installed app; they hold the stats, so that a frame renders them alone. */
function LiveTotals({ containerIds }: { containerIds: readonly string[] }) {
  const { total } = useDockerStats(containerIds);

  return (
    <>
      <StatCard
        title="CPU"
        value={MetricFormat.percent(total(metrics => metrics.cpuPercent))}
        detail="All apps combined"
        icon={CpuIcon}
      />
      <StatCard
        title="Memory"
        value={MetricFormat.bytes(total(metrics => metrics.memoryUsage))}
        detail="All apps combined"
        icon={MemoryStickIcon}
      />
    </>
  );
}

/** The figures of every installed app, then the live usage of their containers. */
function AppsTotals({ projects }: { projects: readonly ProjectSummary[] }) {
  const sum = (count: (project: ProjectSummary) => number) =>
    projects.reduce((total, project) => total + count(project), 0);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard title="Apps" value={projects.length} icon={BoxesIcon} />
      <StatCard title="Services" value={sum(project => project.serviceCount)} icon={LayersIcon} />
      <StatCard title="Running containers" value={sum(project => project.runningCount)} icon={PlayIcon} />
      <StatCard
        title="Stopped containers"
        value={sum(project => project.containerIds.length - project.runningCount)}
        icon={SquareIcon}
      />
      {/* The stats cover every compose project of the host: the ids keep those of Hangar's apps. */}
      <LiveTotals containerIds={projects.flatMap(project => project.containerIds)} />
    </div>
  );
}

/** What the table shows when it has no row: no app installed, or none the search keeps. */
function NoApps({ isInstalled }: { isInstalled: boolean }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageOpenIcon />
        </EmptyMedia>
        <EmptyTitle>{isInstalled ? "No results" : "No apps installed"}</EmptyTitle>
        <EmptyDescription>
          {isInstalled ? "No app matches this search." : "Install an app from the store to find it here."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * `/apps`: the installed apps as Docker runs them, narrowed by the filters and the `q` of the URL. Read again when the
 * server says the daemon changed them, and their usage live.
 */
export function AppsPage() {
  const search = useSearch({ from: "/app/apps" });
  const navigate = useNavigate({ from: "/apps" });
  const { data, error, isPending, refetch, isRefetching } = useDockerProjects();
  const projects = data ?? [];
  const sort = AppsSearchParams.sort(search.sort);

  const visible = ProjectFilter.apply(projects, {
    q: search.q ?? "",
    statuses: AppsSearchParams.statuses(search.status),
    categories: AppsSearchParams.categories(search.category),
    sort,
  });

  const onSort = (column: AppSortColumn) => {
    const next = TableSort.next(sort, column);

    void navigate({
      search: previous => ({ ...previous, sort: next ? TableSort.serialize(next) : undefined }),
      replace: true,
    });
  };

  useDockerChanges();

  return (
    <main>
      <title>Apps | Hangar</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">Apps installed by Hangar and their Docker state.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppsFilterMenus projects={projects} />
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not read the apps</AlertTitle>
          <AlertDescription>{ErrorMessage.describe(error)}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" disabled={isRefetching} onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {data && (
        <>
          <AppsTotals projects={projects} />
          {visible.length > 0 ? (
            <AppsTable projects={visible} sort={sort} onSort={onSort} />
          ) : (
            <NoApps isInstalled={projects.length > 0} />
          )}
        </>
      )}
      {isPending && <p className="text-sm text-muted-foreground">Reading Docker…</p>}
    </main>
  );
}
