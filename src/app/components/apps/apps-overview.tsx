"use client";

import { BoxesIcon, LayersIcon, PackageOpenIcon, PlayIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import { useSetSearch_UNSTABLE } from "waku/router/client";
import type { ActionResult } from "#app/actions/action-result.ts";
import type { AppOperation } from "#app/actions/apps/app-operation.ts";
import { AppsStatusFilter } from "#app/components/apps/apps-status-filter.tsx";
import { AppsTable } from "#app/components/apps/apps-table.tsx";
import { filterProjects, nextSort, statusCounts } from "#app/components/apps/filter.ts";
import { StatCard } from "#app/components/apps/stat-card.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardHeader } from "#app/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#app/components/ui/empty.tsx";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useDockerPolling } from "#app/hooks/use-docker-polling.ts";
import type { AppSortColumn, AppsSearch } from "#app/search-codecs.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker";

type AppsOverviewProps = {
  initialData: ComposeProjectsSnapshot | null;
  initialError: string | null;
  manageApp?: ((project: string, operation: AppOperation) => Promise<ActionResult>) | undefined;
  search: AppsSearch;
};

function OverviewSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Chargement des apps Docker">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function AppsOverview({ initialData, initialError, manageApp, search }: AppsOverviewProps) {
  // The server render is already a complete snapshot, so don't re-fetch it on mount — unless it
  // failed, in which case polling immediately is the retry.
  const { data, error, isRefreshing, isStale, refresh } = useDockerPolling("/api/docker/apps", initialData, {
    immediate: initialData === null,
  });
  const setSearch = useSetSearch_UNSTABLE({ from: "/apps" });
  const onSort = (column: AppSortColumn) => void setSearch({ sort: nextSort(search.sort, column) });
  const visibleError = error ?? (data ? null : initialError);
  const projects = data?.projects ?? [];
  // Filtering runs on the polled snapshot, not the server render: the data moves every 5s.
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

  return (
    <>
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

      {visibleError && (
        <Alert variant={data ? "default" : "destructive"}>
          <AlertTitle>{isStale ? "Données non actualisées" : "Docker indisponible"}</AlertTitle>
          <AlertDescription>{visibleError}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </AlertAction>
        </Alert>
      )}

      {!data && !visibleError ? (
        <OverviewSkeleton />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Applications" value={projects.length} icon={BoxesIcon} />
            <StatCard title="Services" value={totals.services} icon={LayersIcon} />
            <StatCard title="Conteneurs actifs" value={totals.running} icon={PlayIcon} />
            <StatCard title="Conteneurs arrêtés" value={totals.stopped} icon={SquareIcon} />
          </div>

          {visible.length > 0 ? (
            <AppsTable projects={visible} manageApp={manageApp} refresh={refresh} sort={search.sort} onSort={onSort} />
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
      ) : null}
    </>
  );
}
