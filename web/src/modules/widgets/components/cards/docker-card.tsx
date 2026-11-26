import { useDockerOverview } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetError, WidgetSkeleton } from "../widget-states.tsx";
import { WidgetCard, WidgetContent, WidgetHeader, WidgetMetadata } from "../widget.tsx";
import { HostMetrics } from "./host-metrics.tsx";

/**
 * The containers, images and volumes of the Docker host Hangar runs on, from the Docker routes, which the daemon's
 * changes keep fresh: the dashboard follows them, and reads the overview again as it changes.
 */
export function DockerCard() {
  const look = WidgetAppearance.get("docker-general-stats");
  const { data: overview, error } = useDockerOverview();

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
    </WidgetCard>
  );
}
