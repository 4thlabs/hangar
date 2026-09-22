import { Link } from "waku";
import type { DockerOverview } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { outdatedProjects } from "#libs/jobs";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
  formatBytes,
  integerFormatter,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type DockerGeneralStatsCardProps = {
  overview: DockerOverview;
  /** Installed apps the last image check found behind their registry. */
  outdated: string[];
};

/** What the widget loads: the host counts, plus the apps due an image update. */
type DockerGeneralStats = DockerGeneralStatsCardProps;

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Local", icon: <IconSelfh name="docker" />, className: "@container min-h-64" };

export function DockerGeneralStatsCard({ overview, outdated }: DockerGeneralStatsCardProps) {
  const { version, containers, images, volumes } = overview;

  return (
    <WidgetCard className={chrome.className}>
      <WidgetHeader
        icon={chrome.icon}
        title={chrome.title}
        description={
          <WidgetMetadata>
            <span>Docker {version}</span>
            <span>{integerFormatter.format(containers.total)} containers</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label="Running" value={containers.running} />
          <WidgetMetric
            label="Stopped"
            value={containers.stopped}
            tone={containers.stopped > 0 ? "destructive" : "default"}
          />
          <WidgetMetric
            label="Images"
            value={images.total}
            detail={`${integerFormatter.format(images.unused)} unused · ${formatBytes(images.size)}`}
          />
          <WidgetMetric
            label="Volumes"
            value={volumes.total}
            detail={`${integerFormatter.format(volumes.inUse)} in use · ${integerFormatter.format(volumes.unused)} unused`}
          />
        </WidgetMetricGrid>
      </WidgetContent>

      {outdated.length > 0 && (
        <WidgetFooter title="Updates available">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {outdated.map(project => (
              <li key={project}>
                <Link
                  to={{ to: "/apps/[project]", params: { project } }}
                  className="font-medium text-chart-4 hover:underline"
                >
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

/**
 * A factory rather than a singleton only so its placement can set a TTL: the cache lives in the
 * widget layer's own map, keyed by id, so a rebuilt widget still finds what the last one loaded.
 */
export const dockerGeneralStats = (ttl?: number) =>
  defineWidget({
    id: "docker-general-stats",
    ttl,
    ...chrome,
    errorDescription: "The local Docker statistics could not be loaded.",
    load: async (): Promise<DockerGeneralStats> => {
      // `outdatedProjects` reads the last completed check; the widget never talks to a registry itself.
      const [overview, outdated] = await Promise.all([docker.overview(), outdatedProjects()]);

      return { overview, outdated: [...outdated].sort() };
    },
    render: ({ overview, outdated }: DockerGeneralStats) => (
      <DockerGeneralStatsCard overview={overview} outdated={outdated} />
    ),
  });
