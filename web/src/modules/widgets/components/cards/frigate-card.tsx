import type { FrigateEvents } from "#libs/api";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "#modules/widgets/components/widget.tsx";
import { defineWidget, type WidgetProps } from "#modules/widgets/define-widget.ts";
import { WidgetIcon, widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";
import { placementImageUrl } from "#modules/widgets/helpers/widget-image.ts";
import { m } from "#paraglide/messages.js";

/** `frigate-events`: Frigate's latest events. */
export const frigateWidget = defineWidget("frigate-events", {
  icon: WidgetIcon.dashboard("frigate", "frigate-light"),
  className: "min-h-88",
  title: m.widgets_frigate_events_title,
  errorDescription: m.widgets_frigate_events_error_description,
  card: FrigateWidget,
});

/** The card, with what it loaded of `GET /widgets/{key}`, in its own region. */
function FrigateWidget({ placement }: WidgetProps) {
  return (
    <LoadedWidget placement={placement} type="frigate-events" look={widgetLook(frigateWidget)}>
      {events => <FrigateCard events={events} placementKey={placement.key} link={placement.link} />}
    </LoadedWidget>
  );
}

/** How the card names a camera: `frigate_front_door` is `front door`. */
function cameraName(camera: string) {
  return camera.replace(/^frigate_/, "").replaceAll("_", " ");
}

type FrigateCardProps = {
  events: FrigateEvents;
  /** The placement's key, which its thumbnails are relayed by. */
  placementKey: string;
  link: string | null;
};

/** Frigate's latest events, with their thumbnails, and how its detection runs. */
export function FrigateCard({
  events: { cameraCount, detectionFps, detectors, events },
  placementKey,
  link,
}: FrigateCardProps) {
  const now = useNow();
  const look = widgetLook(frigateWidget);

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{m.widgets_counts_cameras({ count: cameraCount })}</span>
            <span>{m.widgets_frigate_detections({ perSecond: detectionFps.toFixed(1) })}</span>
            {detectors.map(detector => (
              <span key={detector.name} aria-label={m.widgets_frigate_inference_time({ detector: detector.name })}>
                {detector.inferenceSpeed.toFixed(0)} ms
              </span>
            ))}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty={m.widgets_frigate_empty()}>
          {events.map(event => (
            <WidgetListItem
              key={event.id}
              media={
                <img
                  src={placementImageUrl(placementKey, event.id)}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-16 shrink-0 rounded-sm object-cover"
                />
              }
              trailing={<WidgetTime at={Date.parse(event.startTime)} now={now} />}
            >
              {link ? (
                <a
                  href={`${link}/explore?event_id=${encodeURIComponent(event.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium text-primary hover:underline"
                >
                  {event.label}
                  {event.subLabel && ` · ${event.subLabel}`}
                </a>
              ) : (
                <p className="truncate font-medium text-primary">
                  {event.label}
                  {event.subLabel && ` · ${event.subLabel}`}
                </p>
              )}
              <p className="truncate text-xs text-muted-foreground">{cameraName(event.camera)}</p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
