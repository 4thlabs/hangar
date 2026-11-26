import type { ArcaneGeneralStats } from "#libs/api";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetCard, WidgetContent, WidgetFooter, WidgetHeader, WidgetMetadata } from "../widget.tsx";
import { HostMetrics } from "./host-metrics.tsx";

/** The color of an item that needs attention, by how pressing it is. */
class Severity {
  static className(severity: string) {
    if (severity === "critical") {
      return "text-destructive";
    }

    if (severity === "warning") {
      return "text-chart-4";
    }

    return "text-muted-foreground";
  }
}

type ArcaneCardProps = {
  stats: ArcaneGeneralStats;
  link: string | null;
};

/** The Docker host as Arcane reports it, and what it says needs attention. */
export function ArcaneCard({ stats: { version, containers, images, volumes, actionItems }, link }: ArcaneCardProps) {
  const look = WidgetAppearance.get("arcane-general-stats");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            {version.updateAvailable ? (
              <a
                href={version.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-destructive hover:underline"
              >
                {version.current} → {version.newest}
              </a>
            ) : (
              <span>{version.current}</span>
            )}
            <span>{Units.count(containers.total, "container", "containers")}</span>
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <HostMetrics containers={containers} images={images} volumes={volumes} />
      </WidgetContent>

      {actionItems.length > 0 && (
        <WidgetFooter title="Needs attention">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {actionItems.map(action => (
              <li key={`${action.kind}-${action.severity}`} className={Severity.className(action.severity)}>
                <span className="font-semibold tabular-nums">{Units.integer(action.count)}</span>{" "}
                {action.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </WidgetFooter>
      )}
    </WidgetCard>
  );
}
