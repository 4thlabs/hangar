//! Jellyfin's parts: what the server holds, and what was added to it last.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Limit;

/// What a card reads of Jellyfin, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct JellyfinRead {
    /// What the server holds, in every library.
    pub counts: bool,
    /// The movies, episodes and albums added last that the widget's `user` may see, newest first, grouped as Jellyfin
    /// groups them: at most this many.
    pub latest: Option<Limit<100>>,
}

/// Jellyfin's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct JellyfinData {
    /// What the server holds, when the read asked.
    pub counts: Option<JellyfinCounts>,
    /// The items added last, when the read asked.
    pub latest: Option<Vec<JellyfinItem>>,
}

/// What a Jellyfin server holds, in every library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct JellyfinCounts {
    /// Its movies.
    pub movies: u64,
    /// Its series.
    pub series: u64,
    /// Their episodes.
    pub episodes: u64,
    /// Its songs.
    pub songs: u64,
}

/// An item of Jellyfin's, as Jellyfin gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JellyfinItem {
    /// Its id.
    pub id: String,
    /// What it is, as Jellyfin names it: `Movie`, `Episode`, `MusicAlbum`.
    pub kind: String,
    /// Its title.
    pub name: String,
    /// The series of an episode.
    pub series_id: Option<String>,
    /// The title of the series of an episode.
    pub series_name: Option<String>,
    /// The artist of an album.
    pub album_artist: Option<String>,
    /// The year it came out.
    pub production_year: Option<u32>,
    /// Its poster, its own or the one that stands for it, as a series' for an episode, relayed by
    /// `GET /services/images/{widget}/{id}`; `None` when it has none.
    pub image_id: Option<String>,
}
