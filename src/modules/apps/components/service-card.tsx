import { s } from "#modules/apps/format.ts";
import { statusLabel, statusVariant } from "#modules/apps/status.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import type { ComposeService } from "#libs/docker";
import { ContainerTable } from "./container-table.tsx";

type ServiceCardProps = { project: string; service: ComposeService };

export function ServiceCard({ project, service }: ServiceCardProps) {
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
        <ContainerTable project={project} containers={service.containers} />
      </CardContent>
    </Card>
  );
}
