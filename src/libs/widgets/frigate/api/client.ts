import "dotenv/config";
import ky from "ky";

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

export const frigateUrl = `https://frigate.${process.env.DOMAIN}`;

export const apiClient = ky.extend({
  baseUrl: process.env.FRIDATE_API_URL || frigateUrl,
  prefix: "/api",
  retry: { limit: 1 },
  timeout: 100,
});

/** Gets the most recent Frigate events. */
export async function getEvents(limit: number = 5) {
  return await apiClient.get<FrigateEvent[]>("events", { searchParams: { limit } }).json();
}

/** Gets Frigate runtime statistics. */
export async function getStats() {
  return await apiClient.get<FrigateStats>("stats").json();
}
