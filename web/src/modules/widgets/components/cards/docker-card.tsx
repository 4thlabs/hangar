import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { DockerOverview, ProjectSummary } from "#libs/api";
import { dockerQueries } from "#modules/common/api/docker-queries.ts";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { useDockerChanges } from "#modules/common/hooks/use-docker-changes.ts";
import { WidgetFailure, WidgetSkeleton } from "#modules/widgets/components/widget-states.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";
import { HostMetrics } from "./host-metrics.tsx";

/**
 * The containers, images and volumes of the Docker host Hangar runs on, and the installed apps the image check found
 * behind their registry, from the Docker routes, in its own region: the card follows the daemon's changes, and reads
 * them again as they change. The card never asks a registry itself.
 */
export function DockerCard() {
  const look = widgetLook("docker-general-stats");
  // Read together, above the region: the updates show once read, and none while they are not.
  const overview = useQuery(dockerQueries.overview());
  const { data: projects } = useQuery(dockerQueries.projects());

  // Followed while the host is read too, or failed: a change meanwhile reads it again.
  useDockerChanges();

  return (
    <QueryRegion
      query={overview}
      fallback={<WidgetSkeleton look={look} />}
      failure={failure => <WidgetFailure look={look} {...failure} />}
    >
      {host => <DockerHost overview={host} projects={projects ?? []} />}
    </QueryRegion>
  );
}

type DockerHostProps = {
  overview: DockerOverview;
  projects: readonly ProjectSummary[];
};

/** The card, once the host is read, and the installed apps the image check found an update for. */
function DockerHost({ overview, projects }: DockerHostProps) {
  const look = widgetLook("docker-general-stats");

  const outdated = projects
    .filter(project => project.updateAvailable)
    .map(project => project.name)
    .sort();

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_docker_version({ version: overview.version })}</span>
            <span>{m.widgets_counts_containers({ count: overview.containers.total })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <HostMetrics containers={overview.containers} images={overview.images} volumes={overview.volumes} />
      </WidgetContent>

      {outdated.length > 0 && (
        <WidgetFooter title={m.widgets_docker_updates_available()}>
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
