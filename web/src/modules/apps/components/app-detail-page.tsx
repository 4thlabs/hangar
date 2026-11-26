import { Link, useParams } from "@tanstack/react-router";
import { BoxIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon } from "lucide-react";
import { ApiError, useDockerOverview, useDockerProject, type ProjectDetail } from "#libs/api";
import { ComposeDialogs } from "#modules/apps/components/compose-operations.tsx";
import { ProjectActions } from "#modules/apps/components/project-actions.tsx";
import { ReconnectingNotice } from "#modules/apps/components/reconnecting-notice.tsx";
import { ServiceCard } from "#modules/apps/components/service-card.tsx";
import { StatCard } from "#modules/apps/components/stat-card.tsx";
import { useComposeCommand } from "#modules/apps/hooks/use-compose-command.ts";
import { useDockerChanges } from "#modules/apps/hooks/use-docker-changes.ts";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { MemoryLimit } from "#modules/apps/memory-limit.ts";
import { MetricFormat } from "#modules/apps/metric-format.ts";
import { ProjectStatusView } from "#modules/apps/project-status.ts";
import { describeError } from "#modules/common/error-message.ts";
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

/** The usage of the app and its services; they hold the stats, so that a frame leaves the header alone. */
function AppLiveStats({ detail }: { detail: ProjectDetail }) {
  const { stats, total } = useDockerStats(detail.summary.containerIds);
  const { data: overview } = useDockerOverview();
  const bytes = (pick: Parameters<typeof total>[0]) => MetricFormat.bytes(total(pick));
  const limits = detail.summary.containerIds.flatMap(id => (stats[id] ? [stats[id].memoryLimit] : []));
  const available = MemoryLimit.available(limits, overview?.memory);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="CPU"
          value={MetricFormat.percent(total(metrics => metrics.cpuPercent))}
          detail="Sum of the running containers"
          icon={CpuIcon}
        />
        <StatCard
          title="Memory"
          value={bytes(metrics => metrics.memoryUsage)}
          {...(available
            ? { detail: `${MetricFormat.bytes(available.bytes)} ${available.isHost ? "on the host" : "available"}` }
            : {})}
          icon={MemoryStickIcon}
        />
        <StatCard
          title="Network"
          value={`↓ ${bytes(metrics => metrics.networkRx)}`}
          detail={`↑ ${bytes(metrics => metrics.networkTx)}`}
          icon={NetworkIcon}
        />
        <StatCard
          title="Disk"
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
  const services = `${summary.serviceCount} ${summary.serviceCount === 1 ? "service" : "services"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {summary.icon && <img src={summary.icon} alt="" className="size-7 object-contain" />}
        <h1 className="text-2xl font-semibold">{summary.name}</h1>
        <Badge variant={ProjectStatusView.variant(summary.status)}>{ProjectStatusView.Labels[summary.status]}</Badge>
        {summary.updateAvailable && <Badge variant="outline">Update available</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {services} · {summary.runningCount}/{summary.containerIds.length} containers running
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
        <EmptyTitle>App not found</EmptyTitle>
        <EmptyDescription>No installed app is called “{project}”.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/apps">Back to apps</Link>} />
      </EmptyContent>
    </Empty>
  );
}

/**
 * `/apps/:project`: an installed app as Docker runs it, its services and containers, read again when the server says
 * the daemon changed them, their usage live, its compose commands, and the badge of an update the last image check
 * found. Its backups come with #177, and the link to its editor with #172.
 */
export function AppDetailPage() {
  const { project } = useParams({ from: "/app/apps/$project" });

  // Keyed: another app's page starts over, its commands' state and panel included.
  return <AppDetail key={project} project={project} />;
}

/** The page of `project`, whose commands' dialogs and panel stay while a read again fails. */
function AppDetail({ project }: { project: string }) {
  const { data, error, refetch, isPending, isRefetching } = useDockerProject(project);
  const compose = useComposeCommand([project]);
  const isNotFound = error instanceof ApiError && error.status === 404;
  const { isReconnecting } = useDockerChanges();

  return (
    <main>
      <title>{`${project} | Apps | Hangar`}</title>
      <Button variant="link" className="w-fit px-0" render={<Link to="/apps">← All apps</Link>} />
      <ReconnectingNotice isReconnecting={isReconnecting} />
      {isNotFound && <AppNotFound project={project} />}
      {error && !isNotFound && (
        <Alert variant="destructive">
          <AlertTitle>Could not read this app</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" disabled={isRefetching} onClick={() => void refetch()}>
              Retry
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
      {isPending && <p className="text-sm text-muted-foreground">Reading Docker…</p>}
      <ComposeDialogs compose={compose} subject={project} count={1} />
    </main>
  );
}
