import type { ProjectService } from "#libs/api";
import { ContainerTable } from "#modules/apps/components/container-table.tsx";
import { statusBadgeVariant } from "#modules/apps/helpers/project-status.ts";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { appsMessages } from "#modules/apps/messages.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

const words = appsMessages.service;

type ServiceCardProps = { project: string; service: ProjectService; stats: ContainerStats };

/** A service of an app: how it runs, and its containers. */
export function ServiceCard({ project, service, stats }: ServiceCardProps) {
  const total = service.containers.length;
  const unhealthy = service.unhealthyCount > 0 ? ` · ${words.unhealthy({ count: service.unhealthyCount })}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>
          {words.running({ running: service.runningCount, total })}
          {unhealthy}
        </CardDescription>
        <CardAction>
          <Badge variant={statusBadgeVariant(service.status)}>{appsMessages.status[service.status]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <ContainerTable project={project} containers={service.containers} stats={stats} />
      </CardContent>
    </Card>
  );
}
