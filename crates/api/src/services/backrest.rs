//! Backrest's parts: its repositories and how their backups went.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of Backrest, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct BackrestRead {
    /// Its repositories, from its summary dashboard.
    pub repositories: bool,
}

/// Backrest's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackrestData {
    /// Its repositories, in Backrest's order, when the read asked.
    pub repositories: Option<Vec<BackrestRepository>>,
}

/// A repository of Backrest's, and its last backup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackrestRepository {
    /// Its id.
    pub id: String,
    /// How its last backup ended, as `SUCCESS` or `ERROR`; `None` before its first.
    pub status: Option<String>,
    /// Whether its last backup succeeded.
    pub health: BackrestHealth,
    /// When its last backup ran, in RFC 3339.
    pub last_run_at: Option<String>,
    /// How many backups succeeded in the last 30 days.
    pub successes: u64,
    /// The bytes its backups added in the last 30 days.
    pub bytes_added: u64,
    /// The bytes it protects.
    pub protected_bytes: u64,
    /// When its next backup runs, in RFC 3339, when one is planned.
    pub next_backup_at: Option<String>,
}

/// How the last backup of a repository went: only a success is healthy, as on Backrest's own dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackrestHealth {
    /// It has not run yet.
    NeverRun,
    /// It succeeded.
    Healthy,
    /// It did not.
    Failed,
}
