import { Link } from "waku";
import { all, map } from "#libs/cache";
import type { DockerOverview } from "#libs/docker";
import { docker } from "#libs/docker/server";
import { Translation } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";
import { AppsSnapshot } from "#modules/apps/snapshots.ts";
import { navigationPrefetch } from "#modules/common/navigations.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  Units,
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
} from "../shared/index.ts";
import { WidgetsMessages } from "../shared/messages.ts";
import { dockerGeneralStatsDescriptor } from "./descriptor.ts";
import { DockerWidgetMessages } from "./messages.ts";

const { appearance } = dockerGeneralStatsDescriptor;

type DockerGeneralStatsCardProps = {
  overview: DockerOverview;
  /** Installed apps the last image check found behind their registry. */
  outdated: string[];
};

/** What the widget loads: the host counts, plus the apps due an image update. */
type DockerGeneralStats = DockerGeneralStatsCardProps;

export function DockerGeneralStatsCard({
  overview,
  outdated,
  locale,
}: DockerGeneralStatsCardProps & { locale: LocaleCode }) {
  const { version, containers, images, volumes } = overview;
  const t = Translation.create(DockerWidgetMessages, locale);
  const host = Translation.create(WidgetsMessages, locale);
  const integer = (value: number) => Units.integer(value, locale);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        icon={appearance.icon}
        title={t("title")}
        description={
          <WidgetMetadata>
            <span>Docker {version}</span>
            <span>{host("host.containers", { count: integer(containers.total) })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label={host("host.running")} value={containers.running} locale={locale} />
          <WidgetMetric
            label={host("host.stopped")}
            value={containers.stopped}
            locale={locale}
            tone={containers.stopped > 0 ? "destructive" : "default"}
          />
          <WidgetMetric
            label={host("host.images")}
            value={images.total}
            locale={locale}
            detail={host("host.imagesDetail", {
              unused: integer(images.unused),
              size: Units.bytes(images.size, locale),
            })}
          />
          <WidgetMetric
            label={host("host.volumes")}
            value={volumes.total}
            locale={locale}
            detail={host("host.volumesDetail", { inUse: integer(volumes.inUse), unused: integer(volumes.unused) })}
          />
        </WidgetMetricGrid>
      </WidgetContent>

      {outdated.length > 0 && (
        <WidgetFooter title={t("updates")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {outdated.map(project => (
              <li key={project}>
                <Link
                  to={{ to: "/apps/[project]", params: { project } }}
                  unstable_prefetchOnEnter={navigationPrefetch}
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

/** One widget for every placement, rendering the daemon's cached reads: no TTL, it follows Docker events. */
export const dockerGeneralStats: WidgetBody<DockerGeneralStats> = {
  // The last completed check against what runs now; the widget never talks to a registry itself.
  source: () =>
    map(all([docker.overview(), AppsSnapshot.outdated()]), ([overview, outdated]) => ({
      overview,
      outdated: [...outdated].sort(),
    })),
  render: ({ overview, outdated }, _placementKey, locale) => (
    <DockerGeneralStatsCard overview={overview} outdated={outdated} locale={locale} />
  ),
};
