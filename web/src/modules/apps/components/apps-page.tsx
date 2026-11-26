import { useNavigate, useSearch } from "@tanstack/react-router";
import { BoxesIcon, CpuIcon, LayersIcon, MemoryStickIcon, PackageOpenIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { useDockerProjects, type ProjectSummary } from "#libs/api";
import {
  parseAppCategories,
  parseAppsSort,
  parseAppStatuses,
  parseAppUpdates,
  type AppSortColumn,
} from "#modules/apps/apps-search.ts";
import { AppsFilterMenus } from "#modules/apps/components/apps-filter-menus.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { ComposeDialogs, ComposeOperationButtons } from "#modules/apps/components/compose-operations.tsx";
import { ReconnectingNotice } from "#modules/apps/components/reconnecting-notice.tsx";
import { RunningBatches } from "#modules/apps/components/running-batches.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { appCount, composeSubject } from "#modules/apps/compose-actions.ts";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { useDockerChanges } from "#modules/apps/hooks/use-docker-changes.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { formatBytes, formatPercent } from "#modules/apps/metric-format.ts";
import { filterProjects } from "#modules/apps/project-filter.ts";
import { describeError } from "#modules/common/error-message.ts";
import { nextSort, serializeSort } from "#modules/common/table-sort.ts";
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
        value={formatPercent(total(metrics => metrics.cpuPercent))}
        detail="All apps combined"
        icon={CpuIcon}
      />
      <StatCard
        title="Memory"
        value={formatBytes(total(metrics => metrics.memoryUsage))}
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
        title="Not running"
        value={sum(project => project.containerIds.length - project.runningCount)}
        icon={SquareIcon}
      />
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
  const sort = parseAppsSort(search.sort);

  const visible = filterProjects(projects, {
    q: search.q ?? "",
    statuses: parseAppStatuses(search.status),
    categories: parseAppCategories(search.category),
    updates: parseAppUpdates(search.update),
    sort,
  });

  const onSort = (column: AppSortColumn) => {
    const next = nextSort(sort, column);

    void navigate({
      search: previous => ({ ...previous, sort: next ? serializeSort(next) : undefined }),
      replace: true,
    });
  };

  const { isReconnecting } = useDockerChanges();

  // Held by the page, not the table, which goes as a filter or a read again leaves no row: the panel stays.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const selected = visible.map(project => project.name).filter(name => selection.has(name));
  const compose = useComposeCommand(selected);
  const selectionLabel = selected.length === 0 ? "No selection" : `${appCount(selected.length)} selected`;

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
      <ReconnectingNotice isReconnecting={isReconnecting} />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not read the apps</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" disabled={isRefetching} onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {/* A read again that failed shows why alone, not the apps as they were below it. */}
      {data && !error && (
        <>
          <AppsTotals projects={projects} />
          <RunningBatches compose={compose} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {selectionLabel}
            </span>
            <ComposeOperationButtons compose={compose} size="sm" />
          </div>
          {visible.length > 0 ? (
            <AppsTable
              projects={visible}
              sort={sort}
              onSort={onSort}
              selection={selection}
              onSelectionChange={setSelection}
            />
          ) : (
            <NoApps isInstalled={projects.length > 0} />
          )}
        </>
      )}
      {isPending && <p className="text-sm text-muted-foreground">Reading Docker…</p>}
      <ComposeDialogs compose={compose} subject={composeSubject(selected)} count={selected.length} />
    </main>
  );
}
