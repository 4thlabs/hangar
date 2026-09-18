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
  formatRelativeTime,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type FrigateEventsCardProps = {
  events: FrigateEvent[];
  stats: FrigateStats;
  serviceUrl: string;
  now?: number;
};

const frigateWidgetClassName = "min-h-88";
const frigateIcon = <IconSelfh name="frigate" />;

function formatCameraName(camera: string) {
  return camera.replace(/^frigate_/, "").replaceAll("_", " ");
}

export function FrigateEventsCard({ events, stats, serviceUrl, now = Date.now() }: FrigateEventsCardProps) {
  const detectors = Object.entries(stats.detectors);

  return (
    <WidgetCard className={frigateWidgetClassName}>
      <WidgetHeader
        href={serviceUrl}
        icon={frigateIcon}
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
                      {formatRelativeTime(event.start_time * 1_000, now)}
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

export const frigateEvents = defineWidget({
  id: "frigate-events",
  title: "Frigate",
  icon: frigateIcon,
  className: frigateWidgetClassName,
  errorDescription: "The camera events could not be loaded. The rest of the dashboard is still available.",
  skeleton: { withSubtitle: true },
  load: () => Promise.all([getEvents(), getStats()]),
  render: ([events, stats]: [FrigateEvent[], FrigateStats]) => (
    <FrigateEventsCard events={events} stats={stats} serviceUrl={frigateUrl} />
  ),
});
