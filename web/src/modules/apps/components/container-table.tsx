import type { ProjectContainer } from "#libs/api";
import { ContainerStatus } from "#modules/apps/components/container-status.tsx";
import { LogsSheet } from "#modules/apps/components/logs-sheet.tsx";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { MetricFormat } from "#modules/apps/metric-format.ts";
import { Progress } from "#modules/common/ui/progress.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

type ContainerTableProps = { project: string; containers: readonly ProjectContainer[]; stats: ContainerStats };

/** The containers of a service: what each runs, the ports it publishes, its live usage and its log. */
export function ContainerTable({ project, containers, stats }: ContainerTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Container</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Image</TableHead>
          <TableHead>Ports</TableHead>
          <TableHead>CPU</TableHead>
          <TableHead>Memory</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Disk</TableHead>
          <TableHead>Restarts</TableHead>
          <TableHead>Logs</TableHead>
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
  const metrics = stats[container.id] ?? MetricFormat.NoMetrics;
  const ports = ContainerPorts.write(container);

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
      <TableCell className="tabular-nums">{MetricFormat.percent(metrics.cpuPercent)}</TableCell>
      <TableCell className="min-w-44">
        {metrics.memoryUsage === null ? (
          MetricFormat.None
        ) : (
          <Progress value={Math.min(metrics.memoryPercent ?? 0, 100)} aria-label={`Memory used by ${container.name}`}>
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {MetricFormat.bytes(metrics.memoryUsage)} / {MetricFormat.bytes(metrics.memoryLimit)}
            </span>
          </Progress>
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        ↓ {MetricFormat.bytes(metrics.networkRx)} · ↑ {MetricFormat.bytes(metrics.networkTx)}
      </TableCell>
      <TableCell className="tabular-nums">
        ↓ {MetricFormat.bytes(metrics.blockRead)} · ↑ {MetricFormat.bytes(metrics.blockWrite)}
      </TableCell>
      <TableCell className="text-center tabular-nums">{container.restartCount ?? MetricFormat.None}</TableCell>
      <TableCell>
        <LogsSheet project={project} container={container} />
      </TableCell>
    </TableRow>
  );
}

/** How the ports a container publishes read. */
class ContainerPorts {
  /** `0.0.0.0:8080 → 80/tcp`, one per port, or a dash for none. */
  static write(container: ProjectContainer): string {
    if (container.ports.length === 0) {
      return MetricFormat.None;
    }

    return container.ports
      .map(port => `${port.ip || "0.0.0.0"}:${port.publicPort} → ${port.privatePort}/${port.protocol}`)
      .join(", ");
  }
}
