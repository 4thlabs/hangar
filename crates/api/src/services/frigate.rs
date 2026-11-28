//! Frigate's parts: how its detection runs, and its latest events.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Limit;

/// What a card reads of Frigate, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct FrigateRead {
    /// How its detection runs: its cameras, its detectors.
    pub stats: bool,
    /// The latest events, newest first: at most this many.
    pub events: Option<Limit<50>>,
}

/// Frigate's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateData {
    /// How its detection runs, when the read asked.
    pub stats: Option<FrigateStats>,
    /// The latest events, when the read asked.
    pub events: Option<Vec<FrigateEvent>>,
}

/// How Frigate's detection runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateStats {
    /// How many cameras it watches.
    pub camera_count: u64,
    /// How many detections it runs a second, on all its cameras.
    pub detection_fps: f64,
    /// Its detectors, by name.
    pub detectors: Vec<FrigateDetector>,
}

/// A detector of Frigate's, and how fast it runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateDetector {
    /// Its name, as Frigate's config gives it.
    pub name: String,
    /// How long one inference takes, in milliseconds.
    pub inference_speed: f64,
}

/// An event of Frigate's: what a camera saw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateEvent {
    /// Its id.
    pub id: String,
    /// Its thumbnail, relayed by `GET /services/images/{widget}/{id}`.
    pub thumbnail_id: String,
    /// The camera, as `frigate_front_door`.
    pub camera: String,
    /// What was seen, as `person`.
    pub label: String,
    /// What it was recognised as, a face or a plate, when it was.
    pub sub_label: Option<String>,
    /// When it began, in RFC 3339.
    pub start_time: String,
}
