import type { WidgetService } from "../config/config.ts";
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
import { ArcaneClient } from "./api/client.ts";
import type { Dashboard } from "./api/type.ts";
import { arcaneGeneralStatsDescriptor } from "./descriptor.ts";

const { appearance } = arcaneGeneralStatsDescriptor;

type ArcaneGeneralStatsCardProps = {
  dashboard: Dashboard;
  serviceUrl: string;
};

function actionColor(severity: string) {
  if (severity === "critical") {
    return "text-destructive";
  }

  if (severity === "warning") {
    return "text-chart-4";
  }

  return "text-muted-foreground";
}

export function ArcaneGeneralStatsCard({ dashboard, serviceUrl }: ArcaneGeneralStatsCardProps) {
  const { versionInfo, containers, imageUsageCounts, volumeUsageCounts, actionItems } = dashboard;
  const counts = containers.counts;

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            {versionInfo.updateAvailable ? (
              <a
                href={versionInfo.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-destructive hover:underline"
              >
                {versionInfo.displayVersion} → {versionInfo.newestVersion}
              </a>
            ) : (
              <span>{versionInfo.displayVersion}</span>
            )}
            <span>{Units.Integer.format(counts.totalContainers)} containers</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label="Running" value={counts.runningContainers} />
          <WidgetMetric
            label="Stopped"
            value={counts.stoppedContainers}
            tone={counts.stoppedContainers > 0 ? "destructive" : "default"}
          />
          <WidgetMetric
            label="Images"
            value={imageUsageCounts.totalImages}
            detail={`${Units.Integer.format(imageUsageCounts.imagesUnused)} unused · ${Units.bytes(imageUsageCounts.totalImageSize)}`}
          />
          <WidgetMetric
            label="Volumes"
            value={volumeUsageCounts.total}
            detail={`${Units.Integer.format(volumeUsageCounts.inuse)} in use · ${Units.Integer.format(volumeUsageCounts.unused)} unused`}
          />
        </WidgetMetricGrid>
      </WidgetContent>

      {actionItems.items.length > 0 && (
        <WidgetFooter title="Needs attention">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.items.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={actionColor(action.severity)}>
                <span className="font-semibold tabular-nums">{Units.Integer.format(action.count)}</span>{" "}
                {action.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}

/** Arcane's own view of the host, and the link into it. */
export const arcaneGeneralStats = (service: WidgetService): WidgetBody<Dashboard> => ({
  load: async () => {
    const response = await (await ArcaneClient.connect(service)).getDashboard();

    if (!response.success) {
      throw new Error(response.detail ?? "Unsuccessful response");
    }

    return response.data;
  },
  render: dashboard => <ArcaneGeneralStatsCard dashboard={dashboard} serviceUrl={service.link} />,
});
