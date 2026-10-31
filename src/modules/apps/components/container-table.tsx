import type { ComposeContainer } from "#libs/docker";
import { ContainerStatus } from "#modules/apps/components/container-status.tsx";
import { ContainerStreamButton } from "#modules/apps/components/container-stream-button.tsx";
import { MetricFormat } from "#modules/apps/format.ts";
import { EMPTY_METRICS, type ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Progress } from "#modules/common/ui/progress.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#modules/common/ui/table.tsx";

const formatPorts = (container: ComposeContainer) =>
  container.ports.length > 0
    ? container.ports
        .map(port => `${port.IP || "0.0.0.0"}:${port.PublicPort} → ${port.PrivatePort}/${port.Type}`)
        .join(", ")
    : "—";

type ContainerTableProps = { project: string; containers: ComposeContainer[]; stats: ContainerStats };

export function ContainerTable({ project, containers, stats }: ContainerTableProps) {
  const { t, locale } = useTranslation(AppsMessages);
  const bytes = (value: number | null) => MetricFormat.bytes(value, locale);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("container.container")}</TableHead>
          <TableHead>{t("container.state")}</TableHead>
          <TableHead>{t("container.image")}</TableHead>
          <TableHead>{t("container.ports")}</TableHead>
          <TableHead>{t("container.cpu")}</TableHead>
          <TableHead>{t("container.memory")}</TableHead>
          <TableHead>{t("container.network")}</TableHead>
          <TableHead>{t("container.disk")}</TableHead>
          <TableHead>{t("container.restarts")}</TableHead>
          <TableHead>{t("container.console")}</TableHead>
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
              <TableCell className="tabular-nums">{MetricFormat.percent(metrics.cpuPercent, locale)}</TableCell>
              <TableCell className="min-w-44">
                {metrics.memoryUsage === null ? (
                  "—"
                ) : (
                  <Progress
                    value={Math.min(metrics.memoryPercent ?? 0, 100)}
                    aria-label={t("container.memoryUsed", { name: container.name })}
                  >
                    <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                      {bytes(metrics.memoryUsage)} / {bytes(metrics.memoryLimit)}
                    </span>
                  </Progress>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                ↓ {bytes(metrics.networkRx)} · ↑ {bytes(metrics.networkTx)}
              </TableCell>
              <TableCell className="tabular-nums">
                ↓ {bytes(metrics.blockRead)} · ↑ {bytes(metrics.blockWrite)}
              </TableCell>
              <TableCell className="text-center tabular-nums">{container.restartCount ?? "—"}</TableCell>
              <TableCell>
                <ContainerStreamButton project={project} container={container} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
