import type { ComposeContainer } from "#libs/docker";
import { AppsMessages } from "#modules/apps/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";

/** A container's health when it has a healthcheck, its state otherwise. */
export function ContainerStatus({ container }: { container: ComposeContainer }) {
  const { t } = useTranslation(AppsMessages);
  const destructive = container.health === "unhealthy" || container.state === "dead";
  const label = container.health === "none" ? container.state : t(`container.health.${container.health}`);

  return <Badge variant={destructive ? "destructive" : "secondary"}>{label}</Badge>;
}
