import type { ContainerCounts, ImageCounts, VolumeCounts } from "#libs/api";
import { formatBytes, formatInteger } from "#modules/widgets/helpers/widget-format.ts";
import { WidgetMetric, WidgetMetricGrid } from "../widget.tsx";

type HostMetricsProps = {
  containers: ContainerCounts;
  images: ImageCounts;
  volumes: VolumeCounts;
};

/** The containers, images and volumes of a Docker host, as Docker's widget and Arcane's show them. */
export function HostMetrics({ containers, images, volumes }: HostMetricsProps) {
  return (
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
        detail={`${formatInteger(images.unused)} unused · ${formatBytes(images.size)}`}
      />
      <WidgetMetric
        label="Volumes"
        value={volumes.total}
        detail={`${formatInteger(volumes.inUse)} in use · ${formatInteger(volumes.unused)} unused`}
      />
    </WidgetMetricGrid>
  );
}
