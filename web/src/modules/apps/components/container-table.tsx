import type { ProjectContainer } from "#libs/api";
import { ContainerStatus } from "#modules/apps/components/container-status.tsx";
import { LogsSheet } from "#modules/apps/components/logs-sheet.tsx";
import { formatBytes, formatPercent, noMetrics, noReading } from "#modules/apps/helpers/metric-format.ts";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { appsMessages } from "#modules/apps/messages.ts";
import { Progress } from "#modules/common/ui/progress.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

const words = appsMessages.containers;

type ContainerTableProps = { project: string; containers: readonly ProjectContainer[]; stats: ContainerStats };

/** The containers of a service: what each runs, the ports it publishes, its live usage and its log. */
export function ContainerTable({ project, containers, stats }: ContainerTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{words.container}</TableHead>
          <TableHead>{words.state}</TableHead>
          <TableHead>{words.image}</TableHead>
          <TableHead>{words.ports}</TableHead>
          <TableHead>{words.cpu}</TableHead>
          <TableHead>{words.memory}</TableHead>
          <TableHead>{words.network}</TableHead>
          <TableHead>{words.disk}</TableHead>
          <TableHead>{words.restarts}</TableHead>
          <TableHead>{words.logs}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map(container => (
          <ContainerRow key={container.id} project={project} container={container} stats={stats} />
        ))}
      </TableBody>
    </Table>
  );
}

type ContainerRowProps = { project: string; container: ProjectContainer; stats: ContainerStats };

function ContainerRow({ project, container, stats }: ContainerRowProps) {
  const metrics = stats[container.id] ?? noMetrics;
  const ports = publishedPorts(container);

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{container.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{container.id.slice(0, 12)}</span>
        </div>
      </TableCell>
      <TableCell>
        <ContainerStatus container={container} />
      </TableCell>
      <TableCell className="max-w-64 truncate" title={container.image}>
        {container.image}
      </TableCell>
      <TableCell className="max-w-72 truncate" title={ports}>
        {ports}
      </TableCell>
      <TableCell className="tabular-nums">{formatPercent(metrics.cpuPercent)}</TableCell>
      <TableCell className="min-w-44">
        {metrics.memoryUsage === null ? (
          noReading
        ) : (
          <Progress
            value={Math.min(metrics.memoryPercent ?? 0, 100)}
            aria-label={words.memoryUsedBy({ name: container.name })}
          >
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {formatBytes(metrics.memoryUsage)} / {formatBytes(metrics.memoryLimit)}
            </span>
          </Progress>
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        ↓ {formatBytes(metrics.networkRx)} · ↑ {formatBytes(metrics.networkTx)}
      </TableCell>
      <TableCell className="tabular-nums">
        ↓ {formatBytes(metrics.blockRead)} · ↑ {formatBytes(metrics.blockWrite)}
      </TableCell>
      <TableCell className="text-center tabular-nums">{container.restartCount ?? noReading}</TableCell>
      <TableCell>
        <LogsSheet project={project} container={container} />
      </TableCell>
    </TableRow>
  );
}

/** How the ports a container publishes read: `0.0.0.0:8080 → 80/tcp`, one per port, or a dash for none. */
function publishedPorts(container: ProjectContainer): string {
  if (container.ports.length === 0) {
    return noReading;
  }

  return container.ports
    .map(port => `${port.ip || "0.0.0.0"}:${port.publicPort} → ${port.privatePort}/${port.protocol}`)
    .join(", ");
}
