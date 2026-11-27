import type { ContainerCounts, ImageCounts, VolumeCounts } from "#libs/api";
import { WidgetMetric, WidgetMetricGrid } from "#modules/widgets/components/widget.tsx";
import { formatBytes } from "#modules/widgets/helpers/widget-format.ts";
import { m } from "#paraglide/messages.js";

type HostMetricsProps = {
  containers: ContainerCounts;
  images: ImageCounts;
  volumes: VolumeCounts;
};

/** The containers, images and volumes of a Docker host, as Docker's widget and Arcane's show them. */
export function HostMetrics({ containers, images, volumes }: HostMetricsProps) {
  return (
    <WidgetMetricGrid>
      <WidgetMetric label={m.widgets_host_running()} value={containers.running} />
      <WidgetMetric
        label={m.widgets_host_stopped()}
        value={containers.stopped}
        tone={containers.stopped > 0 ? "destructive" : "default"}
      />
      <WidgetMetric
        label={m.widgets_host_images()}
        value={images.total}
        detail={m.widgets_host_images_detail({ unused: images.unused, size: formatBytes(images.size) })}
      />
      <WidgetMetric
        label={m.widgets_host_volumes()}
        value={volumes.total}
        detail={m.widgets_host_volumes_detail({ inUse: volumes.inUse, unused: volumes.unused })}
      />
    </WidgetMetricGrid>
  );
}
