import type { FrigateEvents } from "#libs/api";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { Units } from "#modules/widgets/widget-format.ts";
import { WidgetImage } from "#modules/widgets/widget-image.ts";
import {
  WidgetCard,
  WidgetContent,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetTime,
} from "../widget.tsx";

/** How the card names a camera: `frigate_front_door` is `front door`. */
class CameraName {
  static format(camera: string) {
    return camera.replace(/^frigate_/, "").replaceAll("_", " ");
  }
}

type FrigateCardProps = {
  events: FrigateEvents;
  /** The placement's key, which its thumbnails are relayed by. */
  placementKey: string;
  link: string | null;
  /** For a test that pins the clock. */
  now?: number;
};

/** Frigate's latest events, with their thumbnails, and how its detection runs. */
export function FrigateCard({
  events: { cameraCount, detectionFps, detectors, events },
  placementKey,
  link,
  now = Date.now(),
}: FrigateCardProps) {
  const look = WidgetAppearance.get("frigate-events");

  return (
    <WidgetCard className={look.className}>
      <WidgetHeader
        href={link}
        icon={look.icon}
        title={look.title}
        description={
          <WidgetMetadata>
            <span>{Units.count(cameraCount, "camera", "cameras")}</span>
            <span>{detectionFps.toFixed(1)} det/s</span>
            {detectors.map(detector => (
              <span key={detector.name} aria-label={`${detector.name} detector inference time`}>
                {detector.inferenceSpeed.toFixed(0)} ms
              </span>
            ))}
          </WidgetMetadata>
        }
      />

      <WidgetContent>
        <WidgetList empty="No recent events.">
          {events.map(event => (
            <WidgetListItem
              key={event.id}
              media={
                <img
                  src={WidgetImage.url(placementKey, event.id)}
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
              <p className="truncate text-xs text-muted-foreground">{CameraName.format(event.camera)}</p>
            </WidgetListItem>
          ))}
        </WidgetList>
      </WidgetContent>
    </WidgetCard>
  );
}
