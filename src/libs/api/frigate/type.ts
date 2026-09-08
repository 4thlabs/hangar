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
