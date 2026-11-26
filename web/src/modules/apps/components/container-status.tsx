import type { ProjectContainer } from "#libs/api";
import { containerStatusLabel, isContainerFailing } from "#modules/apps/helpers/project-status.ts";
import { Badge } from "#modules/common/ui/badge.tsx";

/** A container's health when it has a healthcheck, its state otherwise. */
export function ContainerStatus({ container }: { container: ProjectContainer }) {
  return (
    <Badge variant={isContainerFailing(container) ? "destructive" : "secondary"}>
      {containerStatusLabel(container)}
    </Badge>
  );
}
