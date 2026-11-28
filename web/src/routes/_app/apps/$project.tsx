import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { BoxIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";
import { ApiError, type ProjectDetail } from "#libs/api";
import { BackupsCard } from "#modules/apps/components/backups-card.tsx";
import { ComposeDialogs } from "#modules/apps/components/compose-operations.tsx";
import { ProjectActions } from "#modules/apps/components/project-actions.tsx";
import { ReconnectingNotice } from "#modules/apps/components/reconnecting-notice.tsx";
import { ServiceCard } from "#modules/apps/components/service-card.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { appsLabels } from "#modules/apps/helpers/apps-labels.ts";
import { availableMemory } from "#modules/apps/helpers/memory-limit.ts";
import { formatBytes, formatPercent } from "#modules/apps/helpers/metric-format.ts";
import { statusBadgeVariant } from "#modules/apps/helpers/project-status.ts";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { dockerQueries } from "#modules/common/api/docker-queries.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useDockerChanges } from "#modules/common/hooks/use-docker-changes.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#modules/common/ui/empty.tsx";
import { m } from "#paraglide/messages.js";

/**
 * `/apps/$project`, one app: its containers, its logs and its compose operations. A page of its own beside the list
 * at `/apps`, `apps/index.tsx`, not a child rendered inside it: the section has no layout route.
 */
export const Route = createFileRoute("/_app/apps/$project")({
  component: AppDetailPage,
});

/** The usage of the app and its services; they hold the stats, so that a frame leaves the header alone. */
function AppLiveStats({ detail }: { detail: ProjectDetail }) {
  const { stats, total } = useDockerStats(detail.summary.containerIds);
  const { data: overview } = useQuery(dockerQueries.overview());
  const bytes = (pick: Parameters<typeof total>[0]) => formatBytes(total(pick));
  const limits = detail.summary.containerIds.flatMap(id => (stats[id] ? [stats[id].memoryLimit] : []));
  const available = availableMemory(limits, overview?.memory);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={m.apps_stats_cpu()}
          value={formatPercent(total(metrics => metrics.cpuPercent))}
          detail={m.apps_stats_running_sum()}
          icon={CpuIcon}
        />
        <StatCard
          title={m.apps_stats_memory()}
          value={bytes(metrics => metrics.memoryUsage)}
          {...(available
            ? {
                detail: available.isHost
                  ? m.apps_stats_on_the_host({ bytes: formatBytes(available.bytes) })
                  : m.apps_stats_available({ bytes: formatBytes(available.bytes) }),
              }
            : {})}
          icon={MemoryStickIcon}
        />
        <StatCard
          title={m.apps_stats_network()}
          value={`↓ ${bytes(metrics => metrics.networkRx)}`}
          detail={`↑ ${bytes(metrics => metrics.networkTx)}`}
          icon={NetworkIcon}
        />
        <StatCard
          title={m.apps_stats_disk()}
          value={`↓ ${bytes(metrics => metrics.blockRead)}`}
          detail={`↑ ${bytes(metrics => metrics.blockWrite)}`}
          icon={HardDriveIcon}
        />
      </div>
      <div className="flex flex-col gap-4">
        {detail.services.map(service => (
          <ServiceCard key={service.name} project={detail.summary.name} service={service} stats={stats} />
        ))}
      </div>
    </>
  );
}

/** The head of an app's page: its name, how it runs, and what it is made of. */
function AppHeader({ detail: { summary } }: { detail: ProjectDetail }) {
  const services = m.apps_detail_services({ count: summary.serviceCount });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {summary.icon && <img src={summary.icon} alt="" className="size-7 object-contain" />}
        <h1 className="text-2xl font-semibold">{summary.name}</h1>
        <Badge variant={statusBadgeVariant(summary.status)}>{appsLabels.status[summary.status]()}</Badge>
        {summary.updateAvailable && <Badge variant="outline">{m.apps_detail_update_available()}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {services} ·{" "}
        {m.apps_detail_containers_running({ running: summary.runningCount, total: summary.containerIds.length })}
      </p>
    </div>
  );
}

/** What an app that is not installed shows. */
function AppNotFound({ project }: { project: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>{m.apps_detail_not_found()}</EmptyTitle>
        <EmptyDescription>{m.apps_detail_not_found_description({ project })}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/apps">{m.apps_detail_back_to_apps()}</Link>} />
      </EmptyContent>
    </Empty>
  );
}

/**
 * `/apps/:project`: an installed app as Docker runs it, its services and containers, read again when the server says
 * the daemon changed them, their usage live, its compose commands, the badge of an update the last image check found,
 * and its backups, which show whatever Docker answers. The link to its editor comes with #172.
 */
function AppDetailPage() {
  const { project } = useParams({ from: "/_app/apps/$project" });

  // Keyed: another app's page starts over, its commands' state and panel included.
  return <AppDetail key={project} project={project} />;
}

/** The page of `project`, whose commands' dialogs and panel stay while a read again fails. */
function AppDetail({ project }: { project: string }) {
  const { data, error, refetch, isPending, isRefetching } = useQuery(dockerQueries.project(project));
  const compose = useComposeCommand([project]);
  const isNotFound = error instanceof ApiError && error.status === 404;
  const { isReconnecting } = useDockerChanges();

  return (
    <main>
      <title>{m.apps_detail_document_title({ project })}</title>
      <Button variant="link" className="w-fit px-0" render={<Link to="/apps">{m.apps_detail_all_apps()}</Link>} />
      <ReconnectingNotice isReconnecting={isReconnecting} />
      {isNotFound && <AppNotFound project={project} />}
      {error && !isNotFound && (
        <Alert variant="destructive">
          <AlertTitle>{m.apps_detail_read_failed()}</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" disabled={isRefetching} onClick={() => void refetch()}>
              {m.common_actions_retry()}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {/* A read again that failed shows why alone, not the app as it was above it. */}
      {data && !error && (
        <>
          <AppHeader detail={data} />
          <ProjectActions compose={compose} project={project} />
          <AppLiveStats detail={data} />
        </>
      )}
      {isPending && <p className="text-sm text-muted-foreground">{m.apps_detail_reading()}</p>}
      <BackupsCard project={project} />
      <ComposeDialogs compose={compose} subject={project} count={1} />
    </main>
  );
}
