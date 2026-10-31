import type { ComposeService } from "#libs/docker";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { AppsMessages } from "#modules/apps/messages.ts";
import { statusVariant } from "#modules/apps/status.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { ContainerTable } from "./container-table.tsx";

type ServiceCardProps = { project: string; service: ComposeService; stats: ContainerStats };

export function ServiceCard({ project, service, stats }: ServiceCardProps) {
  const { t } = useTranslation(AppsMessages);
  const unhealthy = service.unhealthyCount > 0 ? ` · ${t("service.unhealthy", { count: service.unhealthyCount })}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{service.name}</CardTitle>
        <CardDescription>
          {t("service.containers", { running: service.runningCount, total: service.containers.length })}
          {unhealthy}
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant(service.status)}>{t(`status.${service.status}`)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <ContainerTable project={project} containers={service.containers} stats={stats} />
      </CardContent>
    </Card>
  );
}
