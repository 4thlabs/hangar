import type { ProjectContainer } from "#libs/api";
import { ProjectStatusView } from "#modules/apps/project-status.ts";
import { Badge } from "#modules/common/ui/badge.tsx";

/** A container's health when it has a healthcheck, its state otherwise. */
export function ContainerStatus({ container }: { container: ProjectContainer }) {
  return (
    <Badge variant={ProjectStatusView.isFailing(container) ? "destructive" : "secondary"}>
      {ProjectStatusView.container(container)}
    </Badge>
  );
}
