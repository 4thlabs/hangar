import {CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import type { Dashboard } from "#libs/api/arcane";
import { arcaneUrl, getDashboard } from "#libs/api/arcane";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Skeleton } from "#app/components/ui/skeleton.tsx";
import { cn } from "#libs/utils";
import { IconSelfh } from "#app/components/icon-selfh.tsx";

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

function formatImageSize(bytes: number) {
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function Metric({ label, value, detail, isDestructive = false }: MetricProps) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums text-primary", isDestructive && "text-destructive")}>
        {integerFormatter.format(value)}
      </dd>
      {detail && <dd className="mt-1 truncate text-xs text-muted-foreground">{detail}</dd>}
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
    <Card className="@container w-full">
      <CardHeader className="border-b">
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

export function ArcaneGeneralStatsError() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Arcane</CardTitle>
        <CardDescription>General statistics</CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>Arcane is unavailable</AlertTitle>
          <AlertDescription>
            The general statistics could not be loaded. The rest of the dashboard is still available.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export function ArcaneGeneralStatsSkeleton() {
  return (
    <Card className="w-full" aria-label="Loading Arcane statistics" aria-busy="true">
      <CardHeader className="border-b">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-12" />
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ArcaneGeneralStatsWidget({ environment = 0 }: { environment?: number }) {
  return getDashboard(environment).then(
    response => {
      if (!response.success) {
        console.error(`Failed to load the Arcane dashboard: ${response.detail ?? "Unsuccessful response"}`);
        return <ArcaneGeneralStatsError />;
      }

      return <ArcaneGeneralStatsCard dashboard={response.data} serviceUrl={arcaneUrl} />;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to load the Arcane dashboard: ${message}`);
      return <ArcaneGeneralStatsError />;
    },
  );
}
