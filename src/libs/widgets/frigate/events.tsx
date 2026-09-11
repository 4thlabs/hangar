import type { FrigateEvent, FrigateStats } from "./api/client.ts";
import { frigateUrl, getEvents, getStats } from "./api/client.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetError,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetSkeleton,
} from "../shared/index.ts";
import { logger } from "#libs/logs";

/** The data to retrive, self contained api, not used by the cli */
export const GET = () => Promise.all([getEvents(), getStats()]);

type FrigateEventsCardProps = {
  events: FrigateEvent[];
  stats: FrigateStats;
  serviceUrl: string;
  now?: number;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const frigateWidgetClassName = "min-h-88";

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
    <WidgetCard className={frigateWidgetClassName}>
      <WidgetHeader
        href={serviceUrl}
        icon={<IconSelfh name="frigate" />}
        title="Frigate"
        description={
          <WidgetMetadata>
            <span>{Object.keys(stats.cameras).length} cameras</span>
            <span>{stats.detection_fps.toFixed(1)} det/s</span>
            {detectors.map(([name, detector]) => (
              <span key={name} aria-label={`${name} detector inference time`}>
                {detector.inference_speed.toFixed(0)} ms
              </span>
            ))}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        {events.length > 0 ? (
          <WidgetList>
            {events.map(event => {
              const eventUrl = `${serviceUrl}/explore?event_id=${encodeURIComponent(event.id)}`;
              const thumbnailUrl = `${serviceUrl}/api/events/${encodeURIComponent(event.id)}/thumbnail.jpg`;
              const eventDate = new Date(event.start_time * 1_000);

              return (
                <WidgetListItem
                  key={event.id}
                  media={
                    <img
                      src={thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-16 shrink-0 rounded-sm object-cover"
                    />
                  }
                  trailing={
                    <time dateTime={eventDate.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(event.start_time, now)}
                    </time>
                  }
                >
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
                </WidgetListItem>
              );
            })}
          </WidgetList>
        ) : (
          <WidgetEmptyState>No recent events.</WidgetEmptyState>
        )}
      </WidgetContent>
    </WidgetCard>
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
    const [events, stats] = await GET();

    return <FrigateEventsCard events={events} stats={stats} serviceUrl={frigateUrl} />;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Failed to load Frigate events: ${message}`);
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
