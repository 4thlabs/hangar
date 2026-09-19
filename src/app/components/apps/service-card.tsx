import { s } from "#app/components/apps/format.ts";
import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import type { ContainerStats } from "#app/hooks/use-docker-stats.ts";
import type { ComposeService } from "#libs/docker";
import { ContainerTable } from "./container-table.tsx";

type ServiceCardProps = { project: string; service: ComposeService; stats: ContainerStats };

export function ServiceCard({ project, service, stats }: ServiceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>
          {service.runningCount}/{service.containerCount} conteneur{s(service.containerCount)} actif
          {s(service.runningCount)}
          {service.unhealthyCount > 0 ? ` · ${service.unhealthyCount} unhealthy` : ""}
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant(service.status)}>{statusLabel[service.status]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <ContainerTable project={project} containers={service.containers} stats={stats} />
      </CardContent>
    </Card>
  );
}
