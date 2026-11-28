//! Miniflux: how many entries are unread, and the newest.

use std::sync::Arc;

use futures::future::OptionFuture;
use hangar_api::{Limit, MinifluxData, MinifluxEntry, MinifluxRead};
use quoll::client;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, Service};

quoll::api! {
    /// Miniflux's API, under `/v1`.
    #[server(none)]
    api MinifluxApi = "/v1";

    /// A Miniflux API token.
    scheme Token = header "X-Auth-Token";

    #[auth(Token)]
    group Reader {
        GET "/entries?status={status}&order={order}&direction={direction}&limit={limit}"
            => entries(
                status: Option<&str>,
                order: Option<&str>,
                direction: Option<&str>,
                limit: u32,
            ) -> Entries;
    }
}

/// A page of entries, and how many the filter matches whatever the limit.
#[derive(Debug, Deserialize)]
struct Entries {
    total: u64,
    entries: Vec<Entry>,
}

/// An entry, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Entry {
    id: u64,
    title: String,
    url: String,
    published_at: String,
    /// `read`, `unread` or `removed`.
    status: String,
    feed: Feed,
}

#[derive(Debug, Deserialize)]
struct Feed {
    title: String,
}

/// The status of an entry not read yet, and the filter of those.
const UNREAD: &str = "unread";

/// Miniflux, as the widgets read it: its clients, and its parts, each kept by its call.
#[derive(Debug)]
pub(super) struct Miniflux {
    clients: Arc<Clients<MinifluxApiClient>>,
    unread: Part<(), u64>,
    /// The newest entries, by how many.
    entries: Part<Limit<100>, Vec<MinifluxEntry>>,
}

impl Miniflux {
    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            unread: Part::new("Miniflux unread count"),
            entries: Part::new("Miniflux newest entries"),
        }
    }

    /// The parts `read` asks of the Miniflux `locator` finds.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        read: MinifluxRead,
    ) -> Result<MinifluxData, Arc<LoadError>> {
        let MinifluxRead { unread, entries } = read;
        let (unread, entries) = tokio::join!(
            OptionFuture::from(unread.then(|| self.unread(locator))),
            OptionFuture::from(entries.map(|limit| self.entries(locator, limit))),
        );

        Ok(MinifluxData {
            unread: unread.transpose()?,
            entries: entries.transpose()?,
        })
    }

    /// The client of the Miniflux of `service`, with its token.
    fn client(service: &Service) -> Result<MinifluxApiClient, LoadError> {
        service.client::<MinifluxApi>("Miniflux", service.key().map(client::key::<Token>))
    }

    /// How many entries are unread: Miniflux gives the count of a filter whatever its limit, so one unread entry is
    /// enough to count them.
    async fn unread(&self, locator: &Locator) -> Result<u64, Arc<LoadError>> {
        self.unread
            .get(locator, &self.clients, (), |client| async move {
                let unread = client
                    .reader()
                    .entries(Some(UNREAD), None, None, 1)
                    .await
                    .map_err(LoadError::call("count Miniflux's unread entries"))?;

                Ok(unread.total)
            })
            .await
    }

    /// The `limit` newest entries, read or not, newest first.
    async fn entries(
        &self,
        locator: &Locator,
        limit: Limit<100>,
    ) -> Result<Vec<MinifluxEntry>, Arc<LoadError>> {
        self.entries
            .get(locator, &self.clients, limit, move |client| async move {
                let newest = client
                    .reader()
                    .entries(None, Some("published_at"), Some("desc"), limit.get())
                    .await
                    .map_err(LoadError::call("list Miniflux's newest entries"))?;

                Ok(newest
                    .entries
                    .into_iter()
                    .map(|entry| MinifluxEntry {
                        is_unread: entry.status == UNREAD,
                        id: entry.id,
                        title: entry.title,
                        url: entry.url,
                        feed_title: entry.feed.title,
                        published_at: entry.published_at,
                    })
                    .collect())
            })
            .await
    }
}
