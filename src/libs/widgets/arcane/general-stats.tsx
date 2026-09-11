import type { Dashboard } from "#libs/api/arcane";
import { arcaneUrl, getDashboard } from "#libs/api/arcane";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetError,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
  WidgetSkeleton,
} from "../shared/index.ts";
import { logger } from "#libs/logs";

export const GET = (environment: number = 0) => getDashboard(environment);

type ArcaneGeneralStatsCardProps = {
  dashboard: Dashboard;
  serviceUrl: string;
};

const integerFormatter = new Intl.NumberFormat("en-US");
const arcaneWidgetClassName = "@container min-h-64";

function formatImageSize(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function actionColor(severity: string) {
  if (severity === "critical") return "text-destructive";
  if (severity === "warning") return "text-chart-4";
  return "text-muted-foreground";
}

export function ArcaneGeneralStatsCard({ dashboard, serviceUrl }: ArcaneGeneralStatsCardProps) {
  const { versionInfo, containers, imageUsageCounts, volumeUsageCounts, actionItems } = dashboard;
  const counts = containers.counts;

  return (
    <WidgetCard className={arcaneWidgetClassName}>
      <WidgetHeader
        href={serviceUrl}
        icon={<IconSelfh name="arcane" />}
        title="Arcane"
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
          <WidgetMetric label="Running" value={integerFormatter.format(counts.runningContainers)} />
          <WidgetMetric
            label="Stopped"
            value={integerFormatter.format(counts.stoppedContainers)}
            tone={counts.stoppedContainers > 0 ? "destructive" : "default"}
          />
          <WidgetMetric
            label="Images"
            value={integerFormatter.format(imageUsageCounts.totalImages)}
            detail={`${integerFormatter.format(imageUsageCounts.imagesUnused)} unused · ${formatImageSize(imageUsageCounts.totalImageSize)}`}
          />
          <WidgetMetric
            label="Volumes"
            value={integerFormatter.format(volumeUsageCounts.total)}
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

export function ArcaneGeneralStatsSkeleton() {
  return (
    <WidgetSkeleton
      className={arcaneWidgetClassName}
      icon={<IconSelfh name="arcane" />}
      title="Arcane"
      withFooter
      withSubtitle
    />
  );
}

export async function ArcaneGeneralStatsWidget({ environment = 0 }: { environment?: number }) {
  const errorFallback = (
    <WidgetError
      className={arcaneWidgetClassName}
      icon={<IconSelfh name="arcane" />}
      name="Arcane"
      description="The general statistics could not be loaded. The rest of the dashboard is still available."
    />
  );

  try {
    // Using lib/api (this one is used by the cli)
    const response = await GET();

    if (!response.success) {
      logger.error(`Failed to load the Arcane dashboard: ${response.detail ?? "Unsuccessful response"}`);
      return errorFallback;
    }

    return <ArcaneGeneralStatsCard dashboard={response.data} serviceUrl={arcaneUrl} />;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Failed to load the Arcane dashboard: ${message}`);
    return errorFallback;
  }
}
