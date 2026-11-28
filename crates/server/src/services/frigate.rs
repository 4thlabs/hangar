//! Frigate: how its detection runs, and its latest events, and the thumbnail of each event, relayed.

use std::collections::HashMap;
use std::fmt;
use std::marker::PhantomData;
use std::sync::Arc;

use futures::future::OptionFuture;
use hangar_api::{FrigateData, FrigateDetector, FrigateEvent, FrigateRead, FrigateStats, Limit};
use http::StatusCode;
use quoll::{Bytes, client};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Image, Locator, Moment, Service};

quoll::api! {
    /// Frigate's API, under `/api`.
    #[server(none)]
    api FrigateApi = "/api";

    /// A key, when Frigate asks for one.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Nvr {
        GET "/events?limit={limit}" => events(limit: u32) -> Vec<Event>;
        GET "/stats" => stats() -> Stats;
        GET "/events/{id}/thumbnail.jpg" => thumbnail(id: &str) -> Bytes;
    }
}

/// An event, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Event {
    id: String,
    camera: String,
    label: String,
    #[serde(default, deserialize_with = "Event::sub_label")]
    sub_label: Option<String>,
    /// In seconds since the epoch.
    start_time: f64,
}

impl Event {
    /// The sub label, which Frigate writes as text, or as its text and its score, `["Ana", 0.92]`.
    fn sub_label<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
        let label = match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::String(label) => Some(label),
            serde_json::Value::Array(parts) => match parts.into_iter().next() {
                Some(serde_json::Value::String(label)) => Some(label),
                _ => None,
            },
            _ => None,
        };

        Ok(label.filter(|label| !label.is_empty()))
    }
}

/// The stats, with the fields the card reads.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Stats {
    detection_fps: f64,
    cameras: HashMap<String, serde_json::Value>,
    detectors: InOrder<Detector>,
}

/// The entries of a JSON object in the order Frigate writes them, its config's: a map would sort them by name.
#[derive(Debug)]
struct InOrder<T>(Vec<(String, T)>);

impl<T> Default for InOrder<T> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for InOrder<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Entries<T>(PhantomData<T>);

        impl<'de, T: Deserialize<'de>> Visitor<'de> for Entries<T> {
            type Value = InOrder<T>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();

                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }

                Ok(InOrder(entries))
            }
        }

        deserializer.deserialize_map(Entries(PhantomData))
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Detector {
    /// In milliseconds.
    inference_speed: f64,
}

/// Frigate, as the widgets read it: its clients, and its parts, each kept by its call.
#[derive(Debug)]
pub(super) struct Frigate {
    clients: Arc<Clients<FrigateApiClient>>,
    stats: Part<(), FrigateStats>,
    /// The latest events, by how many.
    events: Part<Limit<50>, Vec<FrigateEvent>>,
}

impl Frigate {
    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            stats: Part::new("Frigate stats"),
            events: Part::new("Frigate events"),
        }
    }

    /// The parts `read` asks of the Frigate `locator` finds.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        read: FrigateRead,
    ) -> Result<FrigateData, Arc<LoadError>> {
        let FrigateRead { stats, events } = read;
        let (stats, events) = tokio::join!(
            OptionFuture::from(stats.then(|| self.stats(locator))),
            OptionFuture::from(events.map(|limit| self.events(locator, limit))),
        );

        Ok(FrigateData {
            stats: stats.transpose()?,
            events: events.transpose()?,
        })
    }

    /// The thumbnail of the event `id`, `None` when Frigate has no such event.
    pub(super) async fn thumbnail(
        &self,
        locator: &Locator,
        id: &str,
    ) -> Result<Option<Bytes>, LoadError> {
        match self.clients.of(locator).await?.nvr().thumbnail(id).await {
            Ok(thumbnail) => Ok(Some(thumbnail)),
            Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
            Err(error) => Err(LoadError::call("fetch a thumbnail of Frigate's")(error)),
        }
    }

    /// The client of the Frigate of `service`, with its key.
    fn client(service: &Service) -> Result<FrigateApiClient, LoadError> {
        service.client::<FrigateApi>("Frigate", service.key().map(client::key::<ApiKey>))
    }

    /// How the detection runs: its cameras, its detectors in the order of Frigate's config.
    async fn stats(&self, locator: &Locator) -> Result<FrigateStats, Arc<LoadError>> {
        self.stats
            .get(locator, &self.clients, (), |client| async move {
                let stats = client
                    .nvr()
                    .stats()
                    .await
                    .map_err(LoadError::call("read Frigate's stats"))?;

                Ok(FrigateStats {
                    camera_count: stats.cameras.len() as u64,
                    detection_fps: stats.detection_fps,
                    detectors: stats
                        .detectors
                        .0
                        .into_iter()
                        .map(|(name, detector)| FrigateDetector {
                            name,
                            inference_speed: detector.inference_speed,
                        })
                        .collect(),
                })
            })
            .await
    }

    /// The `limit` latest events, newest first, each with its thumbnail named for the relay.
    async fn events(
        &self,
        locator: &Locator,
        limit: Limit<50>,
    ) -> Result<Vec<FrigateEvent>, Arc<LoadError>> {
        self.events
            .get(locator, &self.clients, limit, move |client| async move {
                let events = client
                    .nvr()
                    .events(limit.get())
                    .await
                    .map_err(LoadError::call("list Frigate's events"))?;

                Ok(events
                    .into_iter()
                    .map(|event| FrigateEvent {
                        thumbnail_id: Image::FrigateThumbnail(event.id.clone()).to_string(),
                        id: event.id,
                        camera: event.camera,
                        label: event.label,
                        sub_label: event.sub_label,
                        start_time: Moment::from_seconds(event.start_time),
                    })
                    .collect())
            })
            .await
    }
}
