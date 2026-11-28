import { cn } from "cn";
import type { BeszelSystem, ServicesBeszelParams } from "#libs/api";
import { compactRelativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { servicesQueries } from "#modules/widgets/api/services-queries.ts";
import { ServiceWidget } from "#modules/widgets/components/service-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { m } from "#paraglide/messages.js";

/** What the card reads of Beszel: the systems the hub monitors. */
const systemsRead = { systems: true } as const satisfies ServicesBeszelParams;

/** `beszel-server-stats`: the systems a Beszel hub monitors. */
export const beszelWidget = defineWidget("beszel-server-stats", {
  icon: WidgetIcon.dashboard("beszel", "beszel-light"),
  className: "min-h-40",
  title: m.widgets_beszel_server_stats_title,
  errorDescription: m.widgets_beszel_server_stats_error_description,
  card: BeszelWidget,
});

/** The card, read from its service in its own region. */
function BeszelWidget({ placement }: WidgetProps) {
  const look = widgetLook(beszelWidget);

  return (
    <ServiceWidget query={servicesQueries.beszel} placement={placement} read={systemsRead} look={look}>
      {({ systems }) => <BeszelCard systems={systems} link={placement.link} />}
    </ServiceWidget>
  );
}

/** The usage past which a bar is the thing on the card to look at. */
const hotUsage = 85;

/** The temperature past which a sensor is. */
const hotTemperature = 80;

/** One reading as a labelled bar. */
function Gauge({ label, value }: { label: string; value: number }) {
  const isHot = value >= hotUsage;

  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-baseline justify-between gap-1 text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">{label}</span>
        <span className={cn("tabular-nums", isHot && "text-destructive")}>{Math.round(value)}%</span>
      </p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", isHot ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

type BeszelCardProps = {
  systems: readonly BeszelSystem[];
  link: string | null;
};

/** The systems a Beszel hub monitors, with their CPU, memory and disk. */
export function BeszelCard({ systems, link }: BeszelCardProps) {
  const now = useNow();
  const look = widgetLook(beszelWidget);
  const down = systems.filter(system => !system.up).length;

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_counts_servers({ count: systems.length })}</span>
            {down > 0 && <span className="text-destructive">{m.widgets_beszel_down({ count: down })}</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={m.widgets_beszel_empty()}>
          {systems.map(system => (
            <WidgetListItem key={system.id} className="flex-col items-stretch gap-1">
              <div className="flex min-w-0 items-center gap-2">
                {/* Decorative: the line beside it says the same. */}
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", system.up ? "bg-primary" : "bg-destructive")}
                />
                <p className="min-w-0 grow truncate font-medium text-primary">{system.name}</p>
                <p className="shrink-0 text-xs text-muted-foreground">
                  <WidgetMetadata>
                    {system.up && system.uptime !== null && (
                      <span>
                        {m.widgets_beszel_up({ since: compactRelativeTime(now - system.uptime * 1_000, now) })}
                      </span>
                    )}
                    {system.temperature !== null && (
                      <span className={system.temperature >= hotTemperature ? "text-destructive" : undefined}>
                        {Math.round(system.temperature)}°C
                      </span>
                    )}
                    {!system.up && <span className="text-destructive">{system.status}</span>}
                  </WidgetMetadata>
                </p>
              </div>

              {/* A system the hub does not hear from has no current reading: its last one would be a bar saying a
                  dead server is at 4% CPU. */}
              {system.up && (
                <div className="flex gap-3" title={system.cpuModel ?? undefined}>
                  <Gauge label={m.widgets_beszel_cpu()} value={system.cpu} />
                  <Gauge label={m.widgets_beszel_memory()} value={system.memory} />
                  <Gauge label={m.widgets_beszel_disk()} value={system.disk} />
                </div>
              )}
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
