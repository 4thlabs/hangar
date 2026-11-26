import type { ProjectService } from "#libs/api";
import { ContainerTable } from "#modules/apps/components/container-table.tsx";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { ProjectStatusView } from "#modules/apps/project-status.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

type ServiceCardProps = { project: string; service: ProjectService; stats: ContainerStats };

/** A service of an app: how it runs, and its containers. */
export function ServiceCard({ project, service, stats }: ServiceCardProps) {
  const total = service.containers.length;
  const unhealthy = service.unhealthyCount > 0 ? ` · ${service.unhealthyCount} unhealthy` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>
          {service.runningCount}/{total} {total === 1 ? "container" : "containers"} running{unhealthy}
        </CardDescription>
        <CardAction>
          <Badge variant={ProjectStatusView.variant(service.status)}>{ProjectStatusView.Labels[service.status]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <ContainerTable project={project} containers={service.containers} stats={stats} />
      </CardContent>
    </Card>
  );
}
