//! Arcane's parts: its dashboard of the Docker host.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{ContainerCounts, ImageCounts, VolumeCounts};

/// What a card reads of Arcane, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ArcaneRead {
    /// The dashboard of its first environment, its own host.
    pub dashboard: bool,
}

/// Arcane's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArcaneData {
    /// The dashboard, when the read asked.
    pub dashboard: Option<ArcaneDashboard>,
}

/// The Docker host as Arcane reports it for its first environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArcaneDashboard {
    /// Arcane's version, and its newest.
    pub version: ArcaneVersion,
    /// The host's containers.
    pub containers: ContainerCounts,
    /// The host's images.
    pub images: ImageCounts,
    /// The host's volumes.
    pub volumes: VolumeCounts,
    /// What Arcane says needs attention, as images to update.
    pub action_items: Vec<ArcaneActionItem>,
}

/// The version of Arcane, and whether a newer one is out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArcaneVersion {
    /// The version it runs, as it shows it.
    pub current: String,
    /// The newest version out; `None` when Arcane does not know it, as when its checks are off.
    pub newest: Option<String>,
    /// Whether `newest` is newer than `current`.
    pub update_available: bool,
    /// The page of the newest release, when Arcane gives it.
    pub release_url: Option<String>,
}

/// What Arcane says needs attention.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ArcaneActionItem {
    /// What it is, in snake case, as `image_update`.
    pub kind: String,
    /// How pressing it is: `critical`, `warning`, or another.
    pub severity: String,
    /// How many there are.
    pub count: u64,
}
