//! Beszel's parts: the systems a hub monitors.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of Beszel, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct BeszelRead {
    /// The systems the hub monitors.
    pub systems: bool,
}

/// Beszel's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BeszelData {
    /// The systems, by name, as the hub's own page lists them, when the read asked.
    pub systems: Option<Vec<BeszelSystem>>,
}

/// A system Beszel monitors. Its readings are those of the last report, 0 when it gave none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BeszelSystem {
    /// Its id in the hub.
    pub id: String,
    /// Its name.
    pub name: String,
    /// `up`, `down`, `paused` or `pending`.
    pub status: String,
    /// Whether it is `up`, the only status whose readings are current.
    pub up: bool,
    /// How long it has run, in seconds, when it reported it.
    pub uptime: Option<u64>,
    /// The CPU it uses, out of 100.
    pub cpu: f64,
    /// The memory it uses, out of 100.
    pub memory: f64,
    /// The root disk it uses, out of 100.
    pub disk: f64,
    /// Its hottest sensor, in °C, when it has one.
    pub temperature: Option<f64>,
    /// Its CPU's model, when it reported it.
    pub cpu_model: Option<String>,
}
