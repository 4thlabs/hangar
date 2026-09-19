import type { JellyfinCounts } from "./api/client.ts";
import { createJellyfinClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetMetric,
  WidgetMetricGrid,
  integerFormatter,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type JellyfinStatsCardProps = {
  counts: JellyfinCounts;
  serviceUrl: string;
};

const jellyfinWidgetClassName = "@container min-h-40";
const jellyfinIcon = <IconSelfh name="jellyfin" />;

export function JellyfinStatsCard({ counts, serviceUrl }: JellyfinStatsCardProps) {
  return (
    <WidgetCard className={jellyfinWidgetClassName}>
      <WidgetHeader bordered href={serviceUrl} icon={jellyfinIcon} title="Jellyfin" />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label="Movies" value={integerFormatter.format(counts.MovieCount)} />
          <WidgetMetric label="TV Shows" value={integerFormatter.format(counts.SeriesCount)} />
          <WidgetMetric label="Episodes" value={integerFormatter.format(counts.EpisodeCount)} />
          <WidgetMetric label="Songs" value={integerFormatter.format(counts.SongCount)} />
        </WidgetMetricGrid>
      </WidgetContent>
    </WidgetCard>
  );
}

/** What the library holds, server-wide. */
export const jellyfinStats = (service: WidgetService) =>
  defineWidget({
    id: "jellyfin-stats",
    title: "Jellyfin",
    icon: jellyfinIcon,
    className: jellyfinWidgetClassName,
    errorDescription: "The Jellyfin library totals could not be loaded.",
    load: async () => (await createJellyfinClient(service)).getCounts(),
    render: (counts: JellyfinCounts) => <JellyfinStatsCard counts={counts} serviceUrl={service.link} />,
  });
