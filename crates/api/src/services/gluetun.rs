//! gluetun's parts: where its tunnel exits.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of gluetun, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct GluetunRead {
    /// Where the tunnel exits, from the control server.
    pub public_ip: bool,
}

/// gluetun's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GluetunData {
    /// Where the tunnel exits, when the read asked.
    pub public_ip: Option<GluetunPublicIp>,
}

/// Where gluetun's tunnel exits: an empty address when it is down, an empty city or country when gluetun could not
/// place it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GluetunPublicIp {
    /// The public address.
    pub public_ip: String,
    /// The city.
    pub city: String,
    /// The country.
    pub country: String,
}
