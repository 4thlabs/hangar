import { ContainerLogsSheet } from "#app/components/apps/container-logs-sheet.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Progress } from "#app/components/ui/progress.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#app/components/ui/table.tsx";
import { formatBytes, formatPercent } from "#app/components/apps/format.ts";
import type { ContainerStats } from "#app/hooks/use-docker-stats.ts";
import { EMPTY_METRICS } from "#app/hooks/use-docker-stats.ts";
import type { ComposeContainer, ContainerHealth } from "#libs/docker/projects.ts";

const healthLabel: Record<ContainerHealth, string> = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  starting: "Démarrage",
  none: "Sans healthcheck",
};

function ContainerStatus({ container }: { container: ComposeContainer }) {
  const destructive = container.health === "unhealthy" || container.state === "dead";
  const label = container.health === "none" ? container.state : healthLabel[container.health];

  return <Badge variant={destructive ? "destructive" : "secondary"}>{label}</Badge>;
}

const formatPorts = (container: ComposeContainer) =>
  container.ports.length > 0
    ? container.ports
        .map(port => `${port.IP || "0.0.0.0"}:${port.PublicPort} → ${port.PrivatePort}/${port.Type}`)
        .join(", ")
    : "—";

type ContainerTableProps = { project: string; containers: ComposeContainer[]; stats: ContainerStats };

export function ContainerTable({ project, containers, stats }: ContainerTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Conteneur</TableHead>
          <TableHead>État</TableHead>
          <TableHead>Image</TableHead>
          <TableHead>Ports</TableHead>
          <TableHead>CPU</TableHead>
          <TableHead>Mémoire</TableHead>
          <TableHead>Réseau</TableHead>
          <TableHead>Disque</TableHead>
          <TableHead>Redémarrages</TableHead>
          <TableHead>Logs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map(container => {
          const metrics = stats[container.id] ?? EMPTY_METRICS;

          return (
            <TableRow key={container.id}>
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
              <TableCell className="max-w-72 truncate" title={formatPorts(container)}>
                {formatPorts(container)}
              </TableCell>
              <TableCell className="tabular-nums">{formatPercent(metrics.cpuPercent)}</TableCell>
              <TableCell className="min-w-44">
                {metrics.memoryUsage === null ? (
                  "—"
                ) : (
                  <Progress
                    value={Math.min(metrics.memoryPercent ?? 0, 100)}
                    aria-label={`Mémoire utilisée par ${container.name}`}
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
              <TableCell className="text-center tabular-nums">{container.restartCount ?? "—"}</TableCell>
              <TableCell>
                <ContainerLogsSheet project={project} containerId={container.id} containerName={container.name} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
