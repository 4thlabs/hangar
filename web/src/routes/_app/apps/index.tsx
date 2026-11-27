import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { BoxesIcon, CpuIcon, LayersIcon, MemoryStickIcon, PackageOpenIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import type { ProjectSummary } from "#libs/api";
import { AppsFilterMenus } from "#modules/apps/components/apps-filter-menus.tsx";
import { AppsTable } from "#modules/apps/components/apps-table.tsx";
import { ComposeDialogs, ComposeOperationButtons } from "#modules/apps/components/compose-operations.tsx";
import { ReconnectingNotice } from "#modules/apps/components/reconnecting-notice.tsx";
import { RunningBatches } from "#modules/apps/components/running-batches.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import {
  parseAppCategories,
  parseAppsSort,
  parseAppStatuses,
  parseAppUpdates,
  validateAppsSearch,
  type AppSortColumn,
} from "#modules/apps/helpers/apps-search.ts";
import { formatBytes, formatPercent } from "#modules/apps/helpers/metric-format.ts";
import { filterProjects } from "#modules/apps/helpers/project-filter.ts";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { appsMessages } from "#modules/apps/messages.ts";
import { dockerQueries } from "#modules/common/api/docker-queries.ts";
import { appCount, composeSubject } from "#modules/common/helpers/compose-actions.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { nextSort, serializeSort } from "#modules/common/helpers/table-sort.ts";
import { useDockerChanges } from "#modules/common/hooks/use-docker-changes.ts";
import { commonMessages } from "#modules/common/messages.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";

const words = appsMessages.list;
const totals = appsMessages.list.totals;

/** `/apps`, the installed apps, filtered by its search. */
export const Route = createFileRoute("/_app/apps/")({
  validateSearch: validateAppsSearch,
  staticData: { searchable: true },
  component: AppsPage,
});

/** The CPU and memory of every installed app; they hold the stats, so that a frame renders them alone. */
function LiveTotals({ containerIds }: { containerIds: readonly string[] }) {
  const { total } = useDockerStats(containerIds);

  return (
    <>
      <StatCard
        title={totals.cpu}
        value={formatPercent(total(metrics => metrics.cpuPercent))}
        detail={totals.allApps}
        icon={CpuIcon}
      />
      <StatCard
        title={totals.memory}
        value={formatBytes(total(metrics => metrics.memoryUsage))}
        detail={totals.allApps}
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
      <StatCard title={totals.apps} value={projects.length} icon={BoxesIcon} />
      <StatCard title={totals.services} value={sum(project => project.serviceCount)} icon={LayersIcon} />
      <StatCard title={totals.runningContainers} value={sum(project => project.runningCount)} icon={PlayIcon} />
      <StatCard
        title={totals.notRunning}
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
        <EmptyTitle>{isInstalled ? words.noResults : words.noApps}</EmptyTitle>
        <EmptyDescription>{isInstalled ? words.noResultsDescription : words.noAppsDescription}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * `/apps`: the installed apps as Docker runs them, narrowed by the filters and the `q` of the URL. Read again when the
 * server says the daemon changed them, and their usage live.
 */
function AppsPage() {
  const search = useSearch({ from: "/_app/apps/" });
  const navigate = useNavigate({ from: "/apps/" });
  const { data, error, isPending, refetch, isRefetching } = useQuery(dockerQueries.projects());
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

  const selectionLabel =
    selected.length === 0 ? words.noSelection : words.selected({ apps: appCount(selected.length) });

  return (
    <main>
      <title>{words.documentTitle}</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{words.title}</h1>
          <p className="text-sm text-muted-foreground">{words.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppsFilterMenus projects={projects} />
        </div>
      </div>
      <ReconnectingNotice isReconnecting={isReconnecting} />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{words.readFailed}</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" disabled={isRefetching} onClick={() => void refetch()}>
              {commonMessages.retry}
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
      {isPending && <p className="text-sm text-muted-foreground">{words.reading}</p>}
      <ComposeDialogs compose={compose} subject={composeSubject(selected)} count={selected.length} />
    </main>
  );
}
