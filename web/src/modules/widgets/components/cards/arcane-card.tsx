import type { ArcaneDashboard, ArcaneVersion, ServicesArcaneParams } from "#libs/api";
import { servicesQueries } from "#modules/widgets/api/services-queries.ts";
import { ServiceWidget } from "#modules/widgets/components/service-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetFooter,
  WidgetHeader,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { formatInteger } from "#modules/widgets/helpers/widget-format.ts";
import { m } from "#paraglide/messages.js";
import { HostMetrics } from "./host-metrics.tsx";

/** What the card reads of Arcane: its dashboard of the Docker host. */
const dashboardRead = { dashboard: true } as const satisfies ServicesArcaneParams;

/** `arcane-general-stats`: Arcane's view of the Docker host. */
export const arcaneWidget = defineWidget("arcane-general-stats", {
  icon: WidgetIcon.dashboard("arcane"),
  className: "@container min-h-64",
  title: m.widgets_arcane_general_stats_title,
  errorDescription: m.widgets_arcane_general_stats_error_description,
  card: ArcaneWidget,
});

/** The card, read from its service in its own region. */
function ArcaneWidget({ placement }: WidgetProps) {
  const look = widgetLook(arcaneWidget);

  return (
    <ServiceWidget query={servicesQueries.arcane} placement={placement} read={dashboardRead} look={look}>
      {({ dashboard }) => <ArcaneCard stats={dashboard} link={placement.link} />}
    </ServiceWidget>
  );
}

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
  stats: ArcaneDashboard;
  link: string | null;
};

/** The Docker host as Arcane reports it, and what it says needs attention. */
export function ArcaneCard({ stats: { version, containers, images, volumes, actionItems }, link }: ArcaneCardProps) {
  const look = widgetLook(arcaneWidget);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <VersionLabel version={version} />
            <span>{m.widgets_counts_containers({ count: containers.total })}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <HostMetrics containers={containers} images={images} volumes={volumes} />
      </WidgetContent>

      {actionItems.length > 0 && (
        <WidgetFooter title={m.widgets_arcane_needs_attention()}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={severityClassName(action.severity)}>
                {/* What it is, as Arcane names it: data, not words of the page's. */}
                <span className="font-semibold tabular-nums">{formatInteger(action.count)}</span> {action.kind}
              </li>
            ))}
          </ul>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
