import { Link } from "@tanstack/react-router";
import { useDockerOverview, useDockerProjects } from "#libs/api";
import { useDockerChanges } from "#modules/apps/hooks/use-docker-changes.ts";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetError, WidgetSkeleton } from "../widget-states.tsx";
import { WidgetCard, WidgetContent, WidgetFooter, WidgetHeader, WidgetMetadata } from "../widget.tsx";
import { HostMetrics } from "./host-metrics.tsx";

/**
 * The containers, images and volumes of the Docker host Hangar runs on, and the installed apps the image check found
 * behind their registry, from the Docker routes: the card follows the daemon's changes, and reads them again as they
 * change. The card never asks a registry itself.
 */
export function DockerCard() {
  const look = WidgetAppearance.get("docker-general-stats");
  const { data: overview, error } = useDockerOverview();
  const { data: projects } = useDockerProjects();

  const outdated = (projects ?? [])
    .filter(project => project.updateAvailable)
    .map(project => project.name)
    .sort();

  useDockerChanges();

  if (error) {
    return <WidgetError look={look} reason={ErrorMessage.describe(error)} />;
  }

  if (overview === undefined) {
    return <WidgetSkeleton look={look} />;
  }

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>Docker {overview.version}</span>
            <span>{Units.count(overview.containers.total, "container", "containers")}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <HostMetrics containers={overview.containers} images={overview.images} volumes={overview.volumes} />
      </WidgetContent>

      {outdated.length > 0 && (
        <WidgetFooter title="Updates available">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {outdated.map(project => (
              <li key={project}>
                <Link to="/apps/$project" params={{ project }} className="font-medium text-chart-4 hover:underline">
                  {project}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
