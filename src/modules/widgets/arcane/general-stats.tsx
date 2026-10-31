import { Translation } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";
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
import { WidgetsMessages } from "../shared/messages.ts";
import { ArcaneClient } from "./api/client.ts";
import type { Dashboard } from "./api/type.ts";
import { arcaneGeneralStatsDescriptor } from "./descriptor.ts";
import { ArcaneMessages } from "./messages.ts";

const { appearance } = arcaneGeneralStatsDescriptor;

type ArcaneGeneralStatsCardProps = {
  dashboard: Dashboard;
  serviceUrl: string;
  locale: LocaleCode;
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

export function ArcaneGeneralStatsCard({ dashboard, serviceUrl, locale }: ArcaneGeneralStatsCardProps) {
  const { versionInfo, containers, imageUsageCounts, volumeUsageCounts, actionItems } = dashboard;
  const counts = containers.counts;
  const t = Translation.create(ArcaneMessages, locale);
  const host = Translation.create(WidgetsMessages, locale);
  const integer = (value: number) => Units.integer(value, locale);

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={t("title")}
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
            <span>{host("host.containers", { count: integer(counts.totalContainers) })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetMetricGrid>
          <WidgetMetric label={host("host.running")} value={counts.runningContainers} locale={locale} />
          <WidgetMetric
            label={host("host.stopped")}
            value={counts.stoppedContainers}
            locale={locale}
            tone={counts.stoppedContainers > 0 ? "destructive" : "default"}
          />
          <WidgetMetric
            label={host("host.images")}
            value={imageUsageCounts.totalImages}
            locale={locale}
            detail={host("host.imagesDetail", {
              unused: integer(imageUsageCounts.imagesUnused),
              size: Units.bytes(imageUsageCounts.totalImageSize, locale),
            })}
          />
          <WidgetMetric
            label={host("host.volumes")}
            value={volumeUsageCounts.total}
            locale={locale}
            detail={host("host.volumesDetail", {
              inUse: integer(volumeUsageCounts.inuse),
              unused: integer(volumeUsageCounts.unused),
            })}
          />
        </WidgetMetricGrid>
      </WidgetContent>

      {actionItems.items.length > 0 && (
        <WidgetFooter title={t("attention")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.items.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={actionColor(action.severity)}>
                <span className="font-semibold tabular-nums">{integer(action.count)}</span>{" "}
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
  render: (dashboard, _placementKey, locale) => (
    <ArcaneGeneralStatsCard dashboard={dashboard} serviceUrl={service.link} locale={locale} />
  ),
});
