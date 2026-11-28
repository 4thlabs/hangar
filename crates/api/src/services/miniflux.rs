//! Miniflux's parts: how many entries are unread, and the newest.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Limit;

/// What a card reads of Miniflux, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct MinifluxRead {
    /// How many entries are unread, in every feed.
    pub unread: bool,
    /// The newest entries, read or not, newest first: at most this many.
    pub entries: Option<Limit<100>>,
}

/// Miniflux's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MinifluxData {
    /// How many entries are unread, when the read asked.
    pub unread: Option<u64>,
    /// The newest entries, when the read asked.
    pub entries: Option<Vec<MinifluxEntry>>,
}

/// An entry of a feed of Miniflux's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MinifluxEntry {
    /// Its id.
    pub id: u64,
    /// Its title.
    pub title: String,
    /// The page it links to.
    pub url: String,
    /// The title of its feed.
    pub feed_title: String,
    /// When it was published, in RFC 3339, as Miniflux writes it.
    pub published_at: String,
    /// Whether it is unread.
    pub is_unread: bool,
}
