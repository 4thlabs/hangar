import type { ComposeContainer, ContainerHealth } from "#libs/docker";
import { Badge } from "#modules/common/ui/badge.tsx";

const healthLabel: Record<ContainerHealth, string> = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  starting: "Démarrage",
  none: "Sans healthcheck",
};

/** A container's health when it has a healthcheck, its state otherwise. */
export function ContainerStatus({ container }: { container: ComposeContainer }) {
  const destructive = container.health === "unhealthy" || container.state === "dead";
  const label = container.health === "none" ? container.state : healthLabel[container.health];

  return <Badge variant={destructive ? "destructive" : "secondary"}>{label}</Badge>;
}
