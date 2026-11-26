//! `jellyfin-latest`: what a Jellyfin server holds and what was added to it last, and the posters, relayed.

use std::collections::{HashMap, HashSet};

use hangar_api::{JellyfinCounts, JellyfinItem, JellyfinLatest};
use http::StatusCode;
use quoll::Bytes;
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// Jellyfin's API, at the root. Its key goes in `Authorization: MediaBrowser Token="..."`, the one form Jellyfin
    /// takes since 10.11 turned its legacy headers off: the client adds it to each of its calls.
    #[server(none)]
    api JellyfinApi = "";

    group Jellyfin {
        GET "/Items/Counts" => counts() -> Counts;
        GET "/Users" => users() -> Vec<User>;
        GET "/Items/Latest?userId={user}&limit={limit}&includeItemTypes={types}&groupItems={grouped}&enableImageTypes={images}"
            => latest(user: &str, limit: u32, types: &str, grouped: bool, images: &str) -> Vec<Item>;
        GET "/Items/{id}/Images/Primary" => poster(id: &str) -> Bytes;
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
struct Counts {
    movie_count: u64,
    series_count: u64,
    episode_count: u64,
    song_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct User {
    id: String,
    name: String,
}

/// An item, with the fields the card reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    kind: String,
    series_id: Option<String>,
    series_name: Option<String>,
    album_artist: Option<String>,
    production_year: Option<u32>,
    /// The images it carries: one without `Primary` has no poster of its own.
    #[serde(default)]
    image_tags: HashMap<String, String>,
    /// The item whose poster stands for its own, an album's say.
    parent_primary_image_item_id: Option<String>,
}

impl Item {
    /// The item as the card shows it: an episode as its series, one poster per show rather than ten stills.
    fn latest(self) -> JellyfinItem {
        let image_id = if self.image_tags.contains_key("Primary") {
            Some(self.id.clone())
        } else {
            self.parent_primary_image_item_id
        };

        match self.kind.as_str() {
            "Episode" => JellyfinItem {
                id: self.series_id.unwrap_or(self.id),
                image_id,
                title: self.series_name.unwrap_or(self.name),
                subtitle: None,
            },
            "MusicAlbum" => JellyfinItem {
                id: self.id,
                image_id,
                title: self.name,
                subtitle: self.album_artist,
            },
            _ => JellyfinItem {
                id: self.id,
                image_id,
                title: self.name,
                subtitle: self.production_year.map(|year| year.to_string()),
            },
        }
    }
}

/// How many posters the card shows.
const ITEMS: usize = 10;

/// How many more items are asked for than shown: Jellyfin cuts the list before it groups the episodes by series.
const OVERFETCH: u32 = 10;

/// What "latest" mixes, as Glance's widget does.
const TYPES: &str = "Movie,Episode,MusicAlbum";

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(JellyfinApiClient);

impl Client {
    /// The client of the service `service`, with its key.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, or the key cannot be sent.
    pub(super) fn new(service: &Service) -> Result<Self, LoadError> {
        build(service).map(Self)
    }
}

/// The client of the Jellyfin of `service`, which sends its key as `MediaBrowser Token="..."`, written by hand:
/// quoll's header schemes cannot say the form of a value.
///
/// # Errors
///
/// When the key cannot go in a header, as one with a line break.
fn build(service: &Service) -> Result<JellyfinApiClient, LoadError> {
    let Some(key) = service.key() else {
        return service.keyless_client::<JellyfinApi>("Jellyfin");
    };
    let credential = Service::authorization(&format!("MediaBrowser Token=\"{key}\""), "Jellyfin")?;

    service.client::<JellyfinApi>("Jellyfin", Some(credential))
}

/// What the Jellyfin of `client` holds, and what `user` may see of what was added last: Jellyfin has no latest of
/// the whole server.
pub(super) async fn load(client: &Client, user: &str) -> Result<JellyfinLatest, LoadError> {
    let jellyfin = client.0.jellyfin();
    let (counts, users) = tokio::join!(jellyfin.counts(), jellyfin.users());
    let counts = counts.map_err(LoadError::call("count Jellyfin's items"))?;
    let users = users.map_err(LoadError::call("list Jellyfin's users"))?;
    // Naming the operator's typo beats a card that only says it could not load.
    let account = users
        .into_iter()
        .find(|candidate| candidate.name == user)
        .ok_or_else(|| LoadError::refused(format!("Jellyfin has no user named {user}")))?;
    let latest = jellyfin
        .latest(
            &account.id,
            ITEMS as u32 * OVERFETCH,
            TYPES,
            true,
            "Primary",
        )
        .await
        .map_err(LoadError::call("list Jellyfin's latest items"))?;
    let mut seen = HashSet::new();
    // A grouped list may still name a series twice.
    let items = latest
        .into_iter()
        .map(Item::latest)
        .filter(|item| seen.insert(item.id.clone()))
        .take(ITEMS)
        .collect();

    Ok(JellyfinLatest {
        counts: JellyfinCounts {
            movies: counts.movie_count,
            series: counts.series_count,
            episodes: counts.episode_count,
            songs: counts.song_count,
        },
        items,
    })
}

/// The poster of the item `id`, `None` when Jellyfin has none.
pub(super) async fn poster(client: &Client, id: &str) -> Result<Option<Bytes>, LoadError> {
    match client.0.jellyfin().poster(id).await {
        Ok(poster) => Ok(Some(poster)),
        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
        Err(error) => Err(LoadError::call("fetch a poster of Jellyfin's")(error)),
    }
}
