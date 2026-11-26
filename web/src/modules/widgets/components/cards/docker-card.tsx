import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ProjectSummary } from "#libs/api";
import { dockerQueries } from "#modules/common/api/docker-queries.ts";
import { Region } from "#modules/common/components/region.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useDockerChanges } from "#modules/common/hooks/use-docker-changes.ts";
import { WidgetError, WidgetSkeleton } from "#modules/widgets/components/widget-states.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatCount } from "#modules/widgets/helpers/widget-format.ts";
import { HostMetrics } from "./host-metrics.tsx";

/**
 * The containers, images and volumes of the Docker host Hangar runs on, and the installed apps the image check found
 * behind their registry, from the Docker routes, in its own region: the card follows the daemon's changes, and reads
 * them again as they change. The card never asks a registry itself.
 */
export function DockerCard() {
  const look = widgetLook("docker-general-stats");
  // Read here, beside the host's suspense read rather than after it: a query in a component that suspends starts once
  // it mounts. The updates show once read, and none while they are not.
  const { data: projects } = useQuery(dockerQueries.projects());

  // Followed while the host is read too, or failed: a change meanwhile reads it again.
  useDockerChanges();

  return (
    <Region
      fallback={<WidgetSkeleton look={look} />}
      failure={({ error, retry }) => <WidgetError look={look} reason={describeError(error)} retry={retry} />}
    >
      <DockerHost projects={projects ?? []} />
    </Region>
  );
}

/** The card, once the host is read, and the installed apps the image check found an update for. */
function DockerHost({ projects }: { projects: readonly ProjectSummary[] }) {
  const look = widgetLook("docker-general-stats");
  const { data: overview } = useSuspenseQuery(dockerQueries.overview());

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
            <span>Docker {overview.version}</span>
            <span>{formatCount(overview.containers.total, "container", "containers")}</span>
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
