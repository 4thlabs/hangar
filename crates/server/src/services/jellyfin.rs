//! Jellyfin: what the server holds, and what was added to it last, each a part of its own, and the posters, relayed.

use std::collections::HashMap;
use std::sync::Arc;

use futures::future::OptionFuture;
use hangar_api::{JellyfinCounts, JellyfinData, JellyfinItem, JellyfinRead, Limit};
use http::StatusCode;
use quoll::Bytes;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Image, Locator, Service};

quoll::api! {
    /// Jellyfin's API, at the root. Its key goes in `Authorization: MediaBrowser Token="..."`, the one form Jellyfin
    /// takes since 10.11 turned its legacy headers off: the client adds it to each of its calls.
    #[server(none)]
    api JellyfinApi = "";

    group Items {
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

/// An item, with the fields a card may read.
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
    /// The item whose poster stands for its own, an episode's series say.
    parent_primary_image_item_id: Option<String>,
}

impl From<Item> for JellyfinItem {
    /// The item as Jellyfin gives it, its poster named for the relay: its own, else the one that stands for it.
    fn from(item: Item) -> Self {
        let poster = if item.image_tags.contains_key("Primary") {
            Some(item.id.clone())
        } else {
            item.parent_primary_image_item_id
        };

        Self {
            id: item.id,
            kind: item.kind,
            name: item.name,
            series_id: item.series_id,
            series_name: item.series_name,
            album_artist: item.album_artist,
            production_year: item.production_year,
            image_id: poster.map(|poster| Image::JellyfinPoster(poster).to_string()),
        }
    }
}

/// Jellyfin, as the widgets read it: its clients, and its parts, each kept by its call.
#[derive(Debug)]
pub(super) struct Jellyfin {
    clients: Arc<Clients<JellyfinApiClient>>,
    counts: Part<(), JellyfinCounts>,
    /// The latest items, by user and how many.
    latest: Part<(String, Limit<100>), Vec<JellyfinItem>>,
}

impl Jellyfin {
    /// What "latest" mixes, as Glance's widget does.
    const TYPES: &str = "Movie,Episode,MusicAlbum";

    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            counts: Part::new("Jellyfin counts"),
            latest: Part::new("Jellyfin latest items"),
        }
    }

    /// The parts `read` asks of the Jellyfin `locator` finds, the latest items those `user` may see. A part asked fails
    /// the read when it fails with no value kept.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        user: &str,
        read: JellyfinRead,
    ) -> Result<JellyfinData, Arc<LoadError>> {
        // Destructured whole, built whole: a part added to the read is a compile error here.
        let JellyfinRead { counts, latest } = read;
        let (counts, latest) = tokio::join!(
            OptionFuture::from(counts.then(|| self.counts(locator))),
            OptionFuture::from(latest.map(|limit| self.latest(locator, user, limit))),
        );

        Ok(JellyfinData {
            counts: counts.transpose()?,
            latest: latest.transpose()?,
        })
    }

    /// The poster of the item `id`, `None` when Jellyfin has none.
    pub(super) async fn poster(
        &self,
        locator: &Locator,
        id: &str,
    ) -> Result<Option<Bytes>, LoadError> {
        match self.clients.of(locator).await?.items().poster(id).await {
            Ok(poster) => Ok(Some(poster)),
            Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
            Err(error) => Err(LoadError::call("fetch a poster of Jellyfin's")(error)),
        }
    }

    /// The client of `service`, which sends its key as `MediaBrowser Token="..."`, written by hand: quoll's header
    /// schemes cannot say the form of a value.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, or the key cannot go in a header, as one with a line break.
    fn client(service: &Service) -> Result<JellyfinApiClient, LoadError> {
        let Some(key) = service.key() else {
            return service.keyless_client::<JellyfinApi>("Jellyfin");
        };
        let credential =
            Service::authorization(&format!("MediaBrowser Token=\"{key}\""), "Jellyfin")?;

        service.client::<JellyfinApi>("Jellyfin", Some(credential))
    }

    /// What the Jellyfin `locator` finds holds.
    async fn counts(&self, locator: &Locator) -> Result<JellyfinCounts, Arc<LoadError>> {
        self.counts
            .get(locator, &self.clients, (), |client| async move {
                let counts = client
                    .items()
                    .counts()
                    .await
                    .map_err(LoadError::call("count Jellyfin's items"))?;

                Ok(JellyfinCounts {
                    movies: counts.movie_count,
                    series: counts.series_count,
                    episodes: counts.episode_count,
                    songs: counts.song_count,
                })
            })
            .await
    }

    /// The `limit` items added last that `user` may see, grouped as Jellyfin groups them: Jellyfin has no latest of the
    /// whole server.
    async fn latest(
        &self,
        locator: &Locator,
        user: &str,
        limit: Limit<100>,
    ) -> Result<Vec<JellyfinItem>, Arc<LoadError>> {
        let call = (user.to_owned(), limit);
        let user = user.to_owned();

        self.latest
            .get(locator, &self.clients, call, move |client| async move {
                let items = client.items();
                let users = items
                    .users()
                    .await
                    .map_err(LoadError::call("list Jellyfin's users"))?;
                // Naming the operator's typo beats a card that only says it could not load.
                let account = users
                    .into_iter()
                    .find(|candidate| candidate.name == user)
                    .ok_or_else(|| {
                        LoadError::refused(format!("Jellyfin has no user named {user}"))
                    })?;
                let latest = items
                    .latest(&account.id, limit.get(), Self::TYPES, true, "Primary")
                    .await
                    .map_err(LoadError::call("list Jellyfin's latest items"))?;

                Ok(latest.into_iter().map(JellyfinItem::from).collect())
            })
            .await
    }
}
