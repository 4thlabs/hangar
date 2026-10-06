import type { WidgetService } from "../../config/config.ts";
import { ServiceClient } from "../../shared/service-client.ts";

/** The subset of a Frigate event displayed by Hangar. */
export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label: string | null;
  start_time: number;
}

/** Detector performance data displayed by Hangar. */
export interface FrigateDetectorStats {
  inference_speed: number;
}

/** The subset of Frigate statistics displayed by Hangar. */
export interface FrigateStats {
  detection_fps: number;
  cameras: Record<string, object>;
  detectors: Record<string, FrigateDetectorStats>;
}

/** Talks to one Frigate instance. */
export class FrigateClient extends ServiceClient {
  static async connect(service: WidgetService) {
    return new FrigateClient(await ServiceClient.client(service));
  }

  getEvents(limit: number = 5) {
    return this.http.get<FrigateEvent[]>("events", { searchParams: { limit } }).json();
  }

  getStats() {
    return this.http.get<FrigateStats>("stats").json();
  }

  /** One event's thumbnail as raw bytes, for `WidgetImages` to relay. */
  getThumbnail(eventId: string) {
    return this.http.get(`events/${eventId}/thumbnail.jpg`);
  }
}
