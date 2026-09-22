import type { Dashboard } from "./api/type.ts";
import { createArcaneClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
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

type ArcaneGeneralStatsCardProps = {
  dashboard: Dashboard;
  serviceUrl: string;
};

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Arcane", icon: <IconSelfh name="arcane" />, className: "@container min-h-64" };

function actionColor(severity: string) {
  if (severity === "critical") return "text-destructive";
  if (severity === "warning") return "text-chart-4";
  return "text-muted-foreground";
}

export function ArcaneGeneralStatsCard({ dashboard, serviceUrl }: ArcaneGeneralStatsCardProps) {
  const { versionInfo, containers, imageUsageCounts, volumeUsageCounts, actionItems } = dashboard;
  const counts = containers.counts;

  return (
    <WidgetCard className={chrome.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={chrome.icon}
        title={chrome.title}
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
            <span>{integerFormatter.format(counts.totalContainers)} containers</span>
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
            detail={`${integerFormatter.format(imageUsageCounts.imagesUnused)} unused · ${formatBytes(imageUsageCounts.totalImageSize)}`}
          />
          <WidgetMetric
            label="Volumes"
            value={volumeUsageCounts.total}
            detail={`${integerFormatter.format(volumeUsageCounts.inuse)} in use · ${integerFormatter.format(volumeUsageCounts.unused)} unused`}
          />
        </WidgetMetricGrid>
      </WidgetContent>

      {actionItems.items.length > 0 && (
        <WidgetFooter title="Needs attention">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.items.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={actionColor(action.severity)}>
                <span className="font-semibold tabular-nums">{integerFormatter.format(action.count)}</span>{" "}
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
export const arcaneGeneralStats = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "arcane-general-stats",
    ttl,
    ...chrome,
    errorDescription: "The general statistics could not be loaded.",
    load: async (environment: number = 0) => {
      const response = await (await createArcaneClient(service)).getDashboard(environment);

      // The API answers 200 with success:false; treat that as a load failure.
      if (!response.success) throw new Error(response.detail ?? "Unsuccessful response");

      return response.data;
    },
    render: (dashboard: Dashboard) => <ArcaneGeneralStatsCard dashboard={dashboard} serviceUrl={service.link} />,
  });
