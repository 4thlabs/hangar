import { statusLabel, statusVariant } from "#app/components/apps/status.ts";
import { Badge } from "#app/components/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import type { ComposeService } from "#libs/docker";
import { ContainerTable } from "./container-table.tsx";

export function ServiceCard({ project, service }: { project: string; service: ComposeService }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>
          {service.runningCount}/{service.containerCount} conteneur{service.containerCount > 1 ? "s" : ""} actif
          {service.runningCount > 1 ? "s" : ""}
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
