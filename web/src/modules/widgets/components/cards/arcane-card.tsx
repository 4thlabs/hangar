import type { ArcaneGeneralStats, ArcaneVersion } from "#libs/api";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatInteger } from "#modules/widgets/helpers/widget-format.ts";
import { widgetsMessages } from "#modules/widgets/messages.ts";
import { HostMetrics } from "./host-metrics.tsx";

/** The color of an item that needs attention, by how pressing it is. */
function severityClassName(severity: string) {
  if (severity === "critical") {
    return "text-destructive";
  }

  if (severity === "warning") {
    return "text-chart-4";
  }

  return "text-muted-foreground";
}

/** Arcane's version, and the newest when it is out, linked to its release when Arcane gives one. */
function VersionLabel({ version }: { version: ArcaneVersion }) {
  if (!version.updateAvailable || version.newest === null) {
    return <span>{version.current}</span>;
  }

  const update = `${version.current} → ${version.newest}`;

  if (version.releaseUrl === null) {
    return <span className="font-medium text-destructive">{update}</span>;
  }

  return (
    <a
      href={version.releaseUrl}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-destructive hover:underline"
    >
      {update}
    </a>
  );
}

type ArcaneCardProps = {
  stats: ArcaneGeneralStats;
  link: string | null;
};

/** The Docker host as Arcane reports it, and what it says needs attention. */
export function ArcaneCard({ stats: { version, containers, images, volumes, actionItems }, link }: ArcaneCardProps) {
  const look = widgetLook("arcane-general-stats");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <VersionLabel version={version} />
            <span>{widgetsMessages.counts.containers({ count: containers.total })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <HostMetrics containers={containers} images={images} volumes={volumes} />
      </WidgetContent>

      {actionItems.length > 0 && (
        <WidgetFooter title={widgetsMessages.arcane.needsAttention}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={severityClassName(action.severity)}>
                <span className="font-semibold tabular-nums">{formatInteger(action.count)}</span>{" "}
                {action.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
