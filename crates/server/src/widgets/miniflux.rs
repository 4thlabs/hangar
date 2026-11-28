//! `miniflux-entries`: Miniflux's newest entries, and how many are unread.

use hangar_api::{MinifluxEntries, MinifluxEntry};
use quoll::client;
use serde::Deserialize;

use crate::services::LoadError;
use crate::services::Service;

quoll::api! {
    /// Miniflux's API, under `/v1`.
    #[server(none)]
    api MinifluxApi = "/v1";

    /// A Miniflux API token.
    scheme Token = header "X-Auth-Token";

    #[auth(Token)]
    group Miniflux {
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

/// How many of the newest entries the card lists.
const ENTRIES: u32 = 8;

/// The status of an entry not read yet, and the filter of those.
const UNREAD: &str = "unread";

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(MinifluxApiClient);

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

/// The client of the Miniflux of `service`, with its token.
fn build(service: &Service) -> Result<MinifluxApiClient, LoadError> {
    service.client::<MinifluxApi>("Miniflux", service.key().map(client::key::<Token>))
}

/// The newest entries of the Miniflux of `client`, and the count of the unread ones, asked at once: Miniflux gives
/// the count of a filter whatever its limit, so one unread entry is enough to count them.
pub(super) async fn load(client: &Client) -> Result<MinifluxEntries, LoadError> {
    let miniflux = client.0.miniflux();
    let (newest, unread) = tokio::join!(
        miniflux.entries(None, Some("published_at"), Some("desc"), ENTRIES),
        miniflux.entries(Some(UNREAD), None, None, 1)
    );
    let newest = newest.map_err(LoadError::call("list Miniflux's newest entries"))?;
    let unread = unread.map_err(LoadError::call("count Miniflux's unread entries"))?;

    Ok(MinifluxEntries {
        unread: unread.total,
        entries: newest
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
            .collect(),
    })
}
