//! `frigate-events`: Frigate's latest events and how its detection runs, and the thumbnail of each event, relayed.

use std::collections::{BTreeMap, HashMap};

use hangar_api::{FrigateDetector, FrigateEvent, FrigateEvents};
use http::StatusCode;
use quoll::Bytes;
use reqwest_middleware::ClientWithMiddleware;
use serde::{Deserialize, Deserializer};

use super::error::LoadError;
use super::service::Service;
use super::time::Moment;

quoll::api! {
    /// Frigate's API, under `/api`. Its key, when it asks for one, goes in `X-API-Key`.
    #[server(none)]
    api FrigateApi = "/api";

    group Frigate {
        GET "/events?limit={limit}" => events(header("X-API-Key") key: Option<&str>, limit: u32) -> Vec<Event>;
        GET "/stats" => stats(header("X-API-Key") key: Option<&str>) -> Stats;
        GET "/events/{id}/thumbnail.jpg" => thumbnail(id: &str, header("X-API-Key") key: Option<&str>) -> Bytes;
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
    detectors: BTreeMap<String, Detector>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Detector {
    /// In milliseconds.
    inference_speed: f64,
}

/// How many of the latest events the card lists.
const EVENTS: u32 = 5;

/// The latest events and the stats of the Frigate of `service`, asked at once.
pub(super) async fn load(
    http: &ClientWithMiddleware,
    service: &Service,
) -> Result<FrigateEvents, LoadError> {
    let client = FrigateApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach Frigate"))?;
    let frigate = client.frigate();
    let (events, stats) = tokio::join!(
        frigate.events(service.key(), EVENTS),
        frigate.stats(service.key())
    );
    let events = events.map_err(LoadError::call("list Frigate's events"))?;
    let stats = stats.map_err(LoadError::call("read Frigate's stats"))?;

    Ok(FrigateEvents {
        camera_count: stats.cameras.len() as u64,
        detection_fps: stats.detection_fps,
        detectors: stats
            .detectors
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
pub(super) async fn thumbnail(
    http: &ClientWithMiddleware,
    service: &Service,
    id: &str,
) -> Result<Option<Bytes>, LoadError> {
    let client = FrigateApi::client_with(http.clone(), &service.api)
        .map_err(LoadError::call("reach Frigate"))?;

    match client.frigate().thumbnail(id, service.key()).await {
        Ok(thumbnail) => Ok(Some(thumbnail)),
        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => Ok(None),
        Err(error) => Err(LoadError::call("fetch a thumbnail of Frigate's")(error)),
    }
}
