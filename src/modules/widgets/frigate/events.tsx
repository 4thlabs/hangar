import type { FrigateEvent, FrigateStats } from "./api/client.ts";
import { FrigateClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#modules/common/components/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
  WidgetImage,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type FrigateEventsCardProps = {
  events: FrigateEvent[];
  stats: FrigateStats;
  serviceUrl: string;
  /** The placement's key, which its relayed thumbnails are addressed by. */
  widget: string;
  now?: number;
};

const chrome = { title: "Frigate", icon: <IconSelfh name="frigate" />, className: "min-h-88" };

function formatCameraName(camera: string) {
  return camera.replace(/^frigate_/, "").replaceAll("_", " ");
}

export function FrigateEventsCard({ events, stats, serviceUrl, widget, now = Date.now() }: FrigateEventsCardProps) {
  const detectors = Object.entries(stats.detectors);

  return (
    <WidgetCard className={chrome.className}>
      <WidgetHeader
        href={serviceUrl}
        icon={chrome.icon}
        title={chrome.title}
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
        <WidgetList empty="No recent events.">
          {events.map(event => {
            const eventUrl = `${serviceUrl}/explore?event_id=${encodeURIComponent(event.id)}`;
            const thumbnailUrl = WidgetImage.url(widget, event.id);

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
                trailing={<WidgetTime at={event.start_time * 1_000} now={now} />}
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
      </WidgetContent>
    </WidgetCard>
  );
}

/** The latest camera events. `link` also builds each per-event deep link, which the browser resolves. */
export const frigateEvents = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "frigate-events",
    ttl,
    ...chrome,
    errorDescription: "The camera events could not be loaded.",
    load: async () => {
      const client = await FrigateClient.connect(service);

      return await Promise.all([client.getEvents(), client.getStats()]);
    },
    render: ([events, stats]: [FrigateEvent[], FrigateStats], key) => (
      <FrigateEventsCard events={events} stats={stats} serviceUrl={service.link} widget={key} />
    ),
  });
