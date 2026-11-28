//! The services the dashboard's widgets read, one route each: a card asks, in one call, the parts of its service it
//! shows, and each part is one call of the service. The server knows the services, never the cards: what a card shows,
//! how many and in which order is the page's.
//!
//! A route takes the placement's key, which leads to the widget's declaration in `hangar.yml`, so to the service's
//! address and key, and a read: what the card asks of the service, booleans and limits only. What names data, a user or
//! a list of repositories, comes from the declaration, never from the request. The images the parts name are relayed
//! by one route for every service, which takes the id the server wrote, as it wrote it.

mod arcane;
mod backrest;
mod beszel;
mod finnhub;
mod forgejo;
mod frigate;
mod github;
mod gluetun;
mod jellyfin;
mod miniflux;
mod tcg_collector;

use std::borrow::Cow;

use quoll::Bytes;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};

pub use arcane::*;
pub use backrest::*;
pub use beszel::*;
pub use finnhub::*;
pub use forgejo::*;
pub use frigate::*;
pub use github::*;
pub use gluetun::*;
pub use jellyfin::*;
pub use miniflux::*;
pub use tcg_collector::*;

/// How many items a part gives at most, from 1 to `MAX`: a read asks no more than its part allows, and the server
/// refuses any other number as it reads the query.
///
/// ```
/// use hangar_api::Limit;
///
/// assert_eq!(Limit::<100>::new(10).map(Limit::get), Some(10));
/// assert_eq!(Limit::<100>::new(0), None);
/// assert_eq!(Limit::<100>::new(101), None);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Limit<const MAX: u32>(u32);

impl<const MAX: u32> Limit<MAX> {
    /// The most the part gives.
    pub const MAX: Self = Self(MAX);

    /// `count`, when it is from 1 to `MAX`.
    pub fn new(count: u32) -> Option<Self> {
        (1..=MAX).contains(&count).then_some(Self(count))
    }

    /// How many items it asks for.
    pub fn get(self) -> u32 {
        self.0
    }
}

impl<'de, const MAX: u32> Deserialize<'de> for Limit<MAX> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let count = u32::deserialize(deserializer)?;

        Self::new(count).ok_or_else(|| {
            de::Error::custom(format!("expected a number from 1 to {MAX}, not {count}"))
        })
    }
}

/// An integer from 1 to `MAX`, written where it is used: a query's parameter says its bounds.
impl<const MAX: u32> JsonSchema for Limit<MAX> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        format!("Limit{MAX}").into()
    }

    fn schema_id() -> Cow<'static, str> {
        format!("hangar_api::Limit<{MAX}>").into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "type": "integer",
            "format": "uint32",
            "minimum": 1,
            "maximum": MAX,
        })
    }
}

quoll::group! {
    /// The services the widgets read, one route each. A route takes the key of a placement of `GET /widgets` and a
    /// read, the parts of the service its card shows: each part asked is in the answer, the others are `null`. Each
    /// part is one call of the service, kept by the call: the service and its parameters, a limit included. Two cards
    /// that make the same call share it. A call is fresh for the widget's `ttl`, 60 seconds unless `hangar.yml` says,
    /// then served while it is made again behind the reader for 15 minutes more, which is also how long a service that
    /// stops answering keeps its last answer. Nothing is called without a reader. A 404 for a key the dashboard does not
    /// place, or that of a widget of another service; a 400 for a read the query cannot hold, as a limit past its part's;
    /// a 502 when the service did not answer a part asked.
    #[auth(crate::Session)]
    pub group Services {
        /// Arcane's dashboard of the Docker host.
        GET "/services/arcane/{widget}" => arcane(widget: &str, query read: ArcaneRead) -> ArcaneData;

        /// Backrest's repositories, and how their backups went.
        GET "/services/backrest/{widget}" => backrest(widget: &str, query read: BackrestRead) -> BackrestData;

        /// The systems a Beszel hub monitors.
        GET "/services/beszel/{widget}" => beszel(widget: &str, query read: BeszelRead) -> BeszelData;

        /// Stock quotes from Finnhub's public API, for the widget's symbols.
        GET "/services/finnhub/{widget}" => finnhub(widget: &str, query read: FinnhubRead) -> FinnhubData;

        /// Forgejo's repositories, and the runs of Forgejo Actions that have not finished.
        GET "/services/forgejo/{widget}" => forgejo(widget: &str, query read: ForgejoRead) -> ForgejoData;

        /// How Frigate's detection runs, and its latest events.
        GET "/services/frigate/{widget}" => frigate(widget: &str, query read: FrigateRead) -> FrigateData;

        /// The latest release of the widget's repositories, from GitHub's public API.
        GET "/services/github/{widget}" => github(widget: &str, query read: GithubRead) -> GithubData;

        /// Where gluetun's tunnel exits.
        GET "/services/gluetun/{widget}" => gluetun(widget: &str, query read: GluetunRead) -> GluetunData;

        /// What a Jellyfin server holds, and what was added to it last.
        GET "/services/jellyfin/{widget}" => jellyfin(widget: &str, query read: JellyfinRead) -> JellyfinData;

        /// How many of Miniflux's entries are unread, and the newest.
        GET "/services/miniflux/{widget}" => miniflux(widget: &str, query read: MinifluxRead) -> MinifluxData;

        /// The cards tcg-collector follows for the widget, and their prices.
        GET "/services/tcg-collector/{widget}"
            => tcg_collector(widget: &str, query read: TcgCollectorRead) -> TcgCollectorData;

        /// An image a part named, by the id the server wrote, as `poster.6c1e2f0a9b`, fetched from the service of the
        /// widget placed as `widget`. Kept a day by the browser. A 404 for an id the server would not write, for an
        /// image of another service than the widget's, and for one its service does not have. Only a raster image is
        /// relayed.
        GET "/services/images/{widget}/{id}" => image(widget: &str, id: &str) -> Bytes;
    }
}
