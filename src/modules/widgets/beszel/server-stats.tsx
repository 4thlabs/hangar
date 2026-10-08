import { cn } from "cn";
import type { WidgetService } from "../config/config.ts";
import type { WidgetBody } from "../shared/define-widget.tsx";
import {
  RelativeTime,
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
} from "../shared/index.ts";
import { BeszelClient, type BeszelSystem } from "./api/client.ts";
import { beszelServerStatsDescriptor } from "./descriptor.ts";

const { appearance } = beszelServerStatsDescriptor;

/** One host, already resolved to what the card shows. */
export type ServerStats = {
  id: string;
  name: string;
  /** Beszel only reports readings for a host it is hearing from. */
  up: boolean;
  status: string;
  /** Seconds, and absent for a host that has never checked in. */
  uptime: number | undefined;
  cpu: number;
  memory: number;
  disk: number;
  /** Hottest sensor in °C, absent on a host that reports none. */
  temperature: number | undefined;
  cpuModel: string | undefined;
};

/** A missing reading counts as 0; bars are drawn only for a host that is up, which reports all three. */
const percent = (value: number | undefined) => value ?? 0;

/** What a system looks like on the card. */
export function displaySystem({ id, name, status, info }: BeszelSystem): ServerStats {
  return {
    id,
    name,
    up: status === "up",
    status,
    uptime: info.u,
    cpu: percent(info.cpu),
    memory: percent(info.mp),
    disk: percent(info.dp),
    temperature: info.dt,
    cpuModel: info.m,
  };
}

/** Past this, a bar is the thing on the card you are meant to look at. */
const HOT = 85;

type GaugeProps = {
  label: string;
  value: number;
};

/** One metric as a labelled bar: a plain `<div>`, since `ui/progress.tsx` is a client component and this never moves. */
function Gauge({ label, value }: GaugeProps) {
  const hot = value >= HOT;

  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-baseline justify-between gap-1 text-xs text-muted-foreground">
        <span className="uppercase tracking-wide">{label}</span>
        <span className={cn("tabular-nums", hot && "text-destructive")}>{Math.round(value)}%</span>
      </p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", hot ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

type BeszelServerStatsCardProps = {
  servers: ServerStats[];
  serviceUrl: string;
  now?: number;
};

export function BeszelServerStatsCard({ servers, serviceUrl, now = Date.now() }: BeszelServerStatsCardProps) {
  const down = servers.filter(server => !server.up).length;

  return (
    <WidgetCard className={appearance.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={appearance.icon}
        title={appearance.title}
        description={
          <WidgetMetadata>
            <span>
              {servers.length} {servers.length === 1 ? "server" : "servers"}
            </span>
            {down > 0 && <span className="text-destructive">{down} down</span>}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No servers monitored.">
          {servers.map(server => (
            <WidgetListItem key={server.id} className="flex-col items-stretch gap-1">
              <div className="flex min-w-0 items-center gap-2">
                {/* Decorative: the line beside it says the same. */}
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", server.up ? "bg-primary" : "bg-destructive")}
                />
                <p className="min-w-0 grow truncate font-medium text-primary">{server.name}</p>
                <p className="shrink-0 text-xs text-muted-foreground">
                  <WidgetMetadata>
                    {server.up && server.uptime !== undefined && (
                      <span>{RelativeTime.compact(now - server.uptime * 1_000, now)} up</span>
                    )}
                    {server.temperature !== undefined && (
                      <span className={server.temperature >= 80 ? "text-destructive" : undefined}>
                        {Math.round(server.temperature)}°C
                      </span>
                    )}
                    {!server.up && <span className="text-destructive">{server.status}</span>}
                  </WidgetMetadata>
                </p>
              </div>

              {/* A host the hub is not hearing from has no readings to draw; its last ones would
                  be a bar claiming a dead server is at 4% CPU. */}
              {server.up && (
                <div className="flex gap-3" title={server.cpuModel}>
                  <Gauge label="CPU" value={server.cpu} />
                  <Gauge label="RAM" value={server.memory} />
                  <Gauge label="Disk" value={server.disk} />
                </div>
              )}
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}

/**
 * Per-host CPU, memory and disk, as the Beszel hub last heard them. Reads only `systems`, whose `info` already holds
 * each host's latest reading: one request, not one per server.
 */
export const beszelServerStats = (service: WidgetService): WidgetBody<ServerStats[]> => ({
  load: async () => (await (await BeszelClient.connect(service)).listSystems()).items.map(displaySystem),
  render: servers => <BeszelServerStatsCard servers={servers} serviceUrl={service.link} />,
});
