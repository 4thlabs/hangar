import { ExternalLinkIcon } from "lucide-react";
import type { FrigateEvent, FrigateStats } from "#libs/api/frigate";
import { frigateUrl, getEvents, getStats } from "#libs/api/frigate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { IconSelfh } from "#app/components/icon-selfh.tsx";
import { WidgetError, WidgetSkeleton } from "../shared/index.ts";

type FrigateEventsCardProps = {
  events: FrigateEvent[];
  stats: FrigateStats;
  serviceUrl: string;
  now?: number;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const frigateWidgetClassName = "min-h-88 w-full";

function formatRelativeTime(timestamp: number, now: number) {
  const seconds = timestamp - now / 1_000;
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 60) return relativeTimeFormatter.format(Math.round(seconds), "second");
  if (absoluteSeconds < 3_600) return relativeTimeFormatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86_400) return relativeTimeFormatter.format(Math.round(seconds / 3_600), "hour");
  return relativeTimeFormatter.format(Math.round(seconds / 86_400), "day");
}

function formatCameraName(camera: string) {
  return camera.replace(/^frigate_/, "").replaceAll("_", " ");
}

export function FrigateEventsCard({ events, stats, serviceUrl, now = Date.now() }: FrigateEventsCardProps) {
  const detectors = Object.entries(stats.detectors);

  return (
    <Card className={frigateWidgetClassName}>
      <CardHeader className="gap-0 border-b">
        <CardTitle>
          <a
            href={serviceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            <IconSelfh name="frigate" />
            Frigate
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{Object.keys(stats.cameras).length} cameras</span>
          <span aria-hidden="true">·</span>
          <span>{stats.detection_fps.toFixed(1)} det/s</span>
          {detectors.map(([name, detector]) => (
            <span key={name} className="inline-flex items-center gap-2">
              <span aria-hidden="true">·</span>
              <span aria-label={`${name} detector inference time`}>{detector.inference_speed.toFixed(0)} ms</span>
            </span>
          ))}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {events.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {events.map(event => {
              const eventUrl = `${serviceUrl}/explore?event_id=${encodeURIComponent(event.id)}`;
              const thumbnailUrl = `${serviceUrl}/api/events/${encodeURIComponent(event.id)}/thumbnail.jpg`;
              const eventDate = new Date(event.start_time * 1_000);

              return (
                <li key={event.id} className="flex min-w-0 items-center gap-2">
                  <img
                    src={thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-16 shrink-0 rounded-sm object-cover"
                  />
                  <div className="min-w-0 grow">
                    <a
                      href={eventUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-medium text-primary hover:underline"
                    >
                      {event.label}
                      {event.sub_label && ` · ${event.sub_label}`}
                    </a>
                    <p className="truncate text-xs text-muted-foreground">{formatCameraName(event.camera)}</p>
                  </div>
                  <time dateTime={eventDate.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(event.start_time, now)}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No recent events.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function FrigateEventsSkeleton() {
  return (
    <WidgetSkeleton
      className={frigateWidgetClassName}
      icon={<IconSelfh name="frigate" />}
      title="Frigate"
      withSubtitle
    />
  );
}

export async function FrigateEventsWidget() {
  try {
    const [events, stats] = await Promise.all([getEvents(), getStats()]);
    return <FrigateEventsCard events={events} stats={stats} serviceUrl={frigateUrl} />;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to load Frigate events: ${message}`);
    return (
      <WidgetError
        className={frigateWidgetClassName}
        icon={<IconSelfh name="frigate" />}
        name="Frigate"
        description="The camera events could not be loaded. The rest of the dashboard is still available."
      />
    );
  }
}
