import { createServiceClient } from "#libs/api/shared";
import { env } from "#libs/env";

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

const { url, client: apiClient } = createServiceClient({
  service: "frigate",
  baseUrl: env.FRIGATE_API_URL,
});

export const frigateUrl = url;
export { apiClient };

/** Gets the most recent Frigate events. */
export async function getEvents(limit: number = 5) {
  return await apiClient.get<FrigateEvent[]>("events", { searchParams: { limit } }).json();
}

/** Gets Frigate runtime statistics. */
export async function getStats() {
  return await apiClient.get<FrigateStats>("stats").json();
}
