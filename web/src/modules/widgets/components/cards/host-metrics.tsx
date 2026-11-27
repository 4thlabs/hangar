import type { ContainerCounts, ImageCounts, VolumeCounts } from "#libs/api";
import { WidgetMetric, WidgetMetricGrid } from "#modules/widgets/components/widget.tsx";
import { formatBytes } from "#modules/widgets/helpers/widget-format.ts";
import { widgetsMessages } from "#modules/widgets/messages.ts";

const words = widgetsMessages.host;

type HostMetricsProps = {
  containers: ContainerCounts;
  images: ImageCounts;
  volumes: VolumeCounts;
};

/** The containers, images and volumes of a Docker host, as Docker's widget and Arcane's show them. */
export function HostMetrics({ containers, images, volumes }: HostMetricsProps) {
  return (
    <WidgetMetricGrid>
      <WidgetMetric label={words.running} value={containers.running} />
      <WidgetMetric
        label={words.stopped}
        value={containers.stopped}
        tone={containers.stopped > 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label={words.images}
        value={images.total}
        detail={words.imagesDetail({ unused: images.unused, size: formatBytes(images.size) })}
      />
      <WidgetMetric
        label={words.volumes}
        value={volumes.total}
        detail={words.volumesDetail({ inUse: volumes.inUse, unused: volumes.unused })}
      />
    </WidgetMetricGrid>
  );
}
