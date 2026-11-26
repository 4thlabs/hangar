//! `frigate-events`: Frigate's latest events and how its detection runs, and the thumbnail of each event, relayed.

use std::collections::HashMap;
use std::fmt;
use std::marker::PhantomData;

use hangar_api::{FrigateDetector, FrigateEvent, FrigateEvents};
use http::StatusCode;
use quoll::{Bytes, client};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};

use super::error::LoadError;
use super::service::Service;
use super::time::Moment;

quoll::api! {
    /// Frigate's API, under `/api`.
    #[server(none)]
    api FrigateApi = "/api";

    /// A key, when Frigate asks for one.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Frigate {
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

/// How many of the latest events the card lists.
const EVENTS: u32 = 5;

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(FrigateApiClient);

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

/// The client of the Frigate of `service`, with its key.
fn build(service: &Service) -> Result<FrigateApiClient, LoadError> {
    service.client::<FrigateApi>("Frigate", service.key().map(client::key::<ApiKey>))
}

/// The latest events and the stats of the Frigate of `client`, asked at once.
pub(super) async fn load(client: &Client) -> Result<FrigateEvents, LoadError> {
    let frigate = client.0.frigate();
    let (events, stats) = tokio::join!(frigate.events(EVENTS), frigate.stats());
    let events = events.map_err(LoadError::call("list Frigate's events"))?;
    let stats = stats.map_err(LoadError::call("read Frigate's stats"))?;

    Ok(FrigateEvents {
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
        events: events
            .into_iter()
            .map(|event| FrigateEvent {
                id: event.id,
                camera: event.camera,
                label: event.label,
                sub_label: event.sub_label,
                start_time: Moment::from_seconds(event.start_time),
            })
            .collect(),
    })
}

/// The thumbnail of the event `id`, `None` when Frigate has no such event.
pub(super) async fn thumbnail(client: &Client, id: &str) -> Result<Option<Bytes>, LoadError> {
    match client.0.frigate().thumbnail(id).await {
        Ok(thumbnail) => Ok(Some(thumbnail)),
        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
        Err(error) => Err(LoadError::call("fetch a thumbnail of Frigate's")(error)),
    }
}
