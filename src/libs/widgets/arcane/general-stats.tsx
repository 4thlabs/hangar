import { ExternalLinkIcon } from "lucide-react";
import type { Dashboard } from "#libs/api/arcane";
import { arcaneUrl, getDashboard } from "#libs/api/arcane";
import { Card } from "#app/components/card/accent-card.tsx";
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { cn } from "#libs/utils";
import { IconSelfh } from "#app/components/icon-selfh.tsx";
import { WidgetError, WidgetSkeleton } from "../shared/index.ts";
import { logger } from "#libs/logs";

type ArcaneGeneralStatsCardProps = {
  dashboard: Dashboard;
  serviceUrl: string;
};

type MetricProps = {
  label: string;
  value: number;
  detail?: string;
  isDestructive?: boolean;
};

const integerFormatter = new Intl.NumberFormat("en-US");
const arcaneWidgetClassName = "@container min-h-64 w-full";

function formatImageSize(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function Metric({ label, value, detail, isDestructive = false }: MetricProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0">
      <dt className="text-xs font-medium uppercase leading-tight tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-2xl font-semibold leading-tight tabular-nums text-primary",
          isDestructive && "text-destructive",
        )}
      >
        {integerFormatter.format(value)}
      </dd>
      {detail && <dd className="truncate text-xs leading-tight text-muted-foreground">{detail}</dd>}
    </div>
  );
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
    <Card className={arcaneWidgetClassName}>
      <CardHeader className="gap-0 border-b">
        <CardTitle>
          <a
            href={serviceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            <IconSelfh name="arcane" />
            Arcane
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
          <span aria-hidden="true">·</span>
          <span>{integerFormatter.format(counts.totalContainers)} containers</span>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <dl className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
          <Metric label="Running" value={counts.runningContainers} />
          <Metric label="Stopped" value={counts.stoppedContainers} isDestructive={counts.stoppedContainers > 0} />
          <Metric
            label="Images"
            value={imageUsageCounts.totalImages}
            detail={`${integerFormatter.format(imageUsageCounts.imagesUnused)} unused · ${formatImageSize(imageUsageCounts.totalImageSize)}`}
          />
          <Metric
            label="Volumes"
            value={volumeUsageCounts.total}
            detail={`${integerFormatter.format(volumeUsageCounts.inuse)} in use · ${integerFormatter.format(volumeUsageCounts.unused)} unused`}
          />
        </dl>
      </CardContent>

      {actionItems.items.length > 0 && (
        <CardFooter className="flex-col items-start gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.items.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={actionColor(action.severity)}>
                <span className="font-semibold tabular-nums">{integerFormatter.format(action.count)}</span>{" "}
                {action.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </CardFooter>
      )}
    </Card>
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
    const response = await getDashboard(environment);

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
