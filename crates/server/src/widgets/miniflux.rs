//! `miniflux-entries`: Miniflux's newest entries, and how many are unread.

use hangar_api::{MinifluxEntries, MinifluxEntry};
use reqwest_middleware::ClientWithMiddleware;
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// Miniflux's API, under `/v1`. Its key, an API token, goes in `X-Auth-Token`.
    #[server(none)]
    api MinifluxApi = "/v1";

    group Miniflux {
        GET "/entries?status={status}&order={order}&direction={direction}&limit={limit}"
            => entries(
                header("X-Auth-Token") key: Option<&str>,
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

/// The newest entries of the Miniflux of `service`, and the count of the unread ones, asked at once: Miniflux gives
/// the count of a filter whatever its limit, so one unread entry is enough to count them.
pub(super) async fn load(
    http: &ClientWithMiddleware,
    service: &Service,
) -> Result<MinifluxEntries, LoadError> {
    let client = MinifluxApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach Miniflux"))?;
    let miniflux = client.miniflux();
    let (newest, unread) = tokio::join!(
        miniflux.entries(
            service.key(),
            None,
            Some("published_at"),
            Some("desc"),
            ENTRIES
        ),
        miniflux.entries(service.key(), Some(UNREAD), None, None, 1)
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
