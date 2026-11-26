//! `jellyfin-latest`: what a Jellyfin server holds and what was added to it last, and the posters, relayed.

use std::collections::{HashMap, HashSet};

use hangar_api::{JellyfinCounts, JellyfinItem, JellyfinLatest};
use http::StatusCode;
use quoll::Bytes;
use reqwest_middleware::ClientWithMiddleware;
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// Jellyfin's API, at the root. Its key goes in `Authorization: MediaBrowser Token="..."`, the one scheme
    /// Jellyfin 12 takes.
    #[server(none)]
    api JellyfinApi = "";

    group Jellyfin {
        GET "/Items/Counts" => counts(header("Authorization") key: Option<&str>) -> Counts;
        GET "/Users" => users(header("Authorization") key: Option<&str>) -> Vec<User>;
        GET "/Items/Latest?userId={user}&limit={limit}&includeItemTypes={types}&groupItems={grouped}&enableImageTypes={images}"
            => latest(
                header("Authorization") key: Option<&str>,
                user: &str,
                limit: u32,
                types: &str,
                grouped: bool,
                images: &str,
            ) -> Vec<Item>;
        GET "/Items/{id}/Images/Primary" => poster(id: &str, header("Authorization") key: Option<&str>) -> Bytes;
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

/// The header of the key of `service`, when it has one.
fn authorization(service: &Service) -> Option<String> {
    service
        .key()
        .map(|key| format!("MediaBrowser Token=\"{key}\""))
}

/// What the Jellyfin of `service` holds, and what `user` may see of what was added last: Jellyfin has no latest of
/// the whole server.
pub(super) async fn load(
    http: &ClientWithMiddleware,
    service: &Service,
    user: &str,
) -> Result<JellyfinLatest, LoadError> {
    let client = JellyfinApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach Jellyfin"))?;
    let jellyfin = client.jellyfin();
    let key = authorization(service);
    let key = key.as_deref();
    let (counts, users) = tokio::join!(jellyfin.counts(key), jellyfin.users(key));
    let counts = counts.map_err(LoadError::call("count Jellyfin's items"))?;
    let users = users.map_err(LoadError::call("list Jellyfin's users"))?;
    // Naming the operator's typo beats a card that only says it could not load.
    let account = users
        .into_iter()
        .find(|candidate| candidate.name == user)
        .ok_or_else(|| LoadError::refused(format!("Jellyfin has no user named {user}")))?;
    let latest = jellyfin
        .latest(
            key,
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
pub(super) async fn poster(
    http: &ClientWithMiddleware,
    service: &Service,
    id: &str,
) -> Result<Option<Bytes>, LoadError> {
    let client = JellyfinApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach Jellyfin"))?;

    match client
        .jellyfin()
        .poster(id, authorization(service).as_deref())
        .await
    {
        Ok(poster) => Ok(Some(poster)),
        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
        Err(error) => Err(LoadError::call("fetch a poster of Jellyfin's")(error)),
    }
}
