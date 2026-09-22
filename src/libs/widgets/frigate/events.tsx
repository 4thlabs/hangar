import type { FrigateEvent, FrigateStats } from "./api/client.ts";
import { createFrigateClient } from "./api/client.ts";
import type { WidgetService } from "../config/config.ts";
import { IconSelfh } from "#app/components/common/icon-selfh.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
  widgetImageUrl,
} from "../shared/index.ts";
import { defineWidget } from "../shared/define-widget.tsx";

type FrigateEventsCardProps = {
  events: FrigateEvent[];
  stats: FrigateStats;
  serviceUrl: string;
  now?: number;
};

/** Stated once, so the card and the fallbacks it degrades to cannot disagree. */
const chrome = { title: "Frigate", icon: <IconSelfh name="frigate" />, className: "min-h-88" };

function formatCameraName(camera: string) {
  return camera.replace(/^frigate_/, "").replaceAll("_", " ");
}

export function FrigateEventsCard({ events, stats, serviceUrl, now = Date.now() }: FrigateEventsCardProps) {
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
            // Relayed by Hangar: the public Frigate host sits behind the OIDC middleware, which
            // answers an `<img>` with a login redirect rather than a picture.
            const thumbnailUrl = widgetImageUrl("frigate-events", event.id);

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

/**
 * The latest camera events, and the link into Frigate itself.
 *
 * `link` reaches further here than in other cards: beyond the header link it also builds every
 * per-event deep link, which the visitor's browser resolves and so cannot point at the container
 * network. Thumbnails go the other way, through Hangar's own relay: an `<img>` cannot answer the
 * OIDC challenge the public host puts in front of the API.
 */
export const frigateEvents = (service: WidgetService, ttl?: number) =>
  defineWidget({
    id: "frigate-events",
    ttl,
    ...chrome,
    errorDescription: "The camera events could not be loaded.",
    load: async () => {
      const client = await createFrigateClient(service);

      return await Promise.all([client.getEvents(), client.getStats()]);
    },
    render: ([events, stats]: [FrigateEvent[], FrigateStats]) => (
      <FrigateEventsCard events={events} stats={stats} serviceUrl={service.link} />
    ),
  });
