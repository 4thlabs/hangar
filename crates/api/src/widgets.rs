//! The dashboard: the widgets `hangar.yml` places, the data each loads from its service, and the images they show,
//! relayed so that the browser needs neither the service's address nor its key.

use quoll::Bytes;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{ContainerCounts, ImageCounts, VolumeCounts};

/// Which widget a placement is, its `type` in `hangar.yml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WidgetType {
    /// The date and time, from the reader's own clock: it loads nothing.
    Clock,
    /// The usage of the Docker host, which the page reads from the Docker routes: it loads nothing here.
    DockerGeneralStats,
    /// Arcane's view of the Docker host.
    ArcaneGeneralStats,
    /// Backrest's repositories and their last backups.
    BackrestSummary,
    /// The systems a Beszel hub monitors.
    BeszelServerStats,
    /// What Forgejo Actions runs, and the repositories updated last.
    ForgejoCi,
    /// Frigate's latest events.
    FrigateEvents,
    /// Whether gluetun's tunnel is up, and where it exits.
    GluetunVpnStatus,
    /// Miniflux's newest entries.
    MinifluxEntries,
    /// What was added to Jellyfin last.
    JellyfinLatest,
    /// The prices of the cards tcg-collector follows.
    TcgCollectorCards,
    /// The latest release of GitHub repositories.
    GithubReleases,
    /// Stock quotes from Finnhub.
    StockPrices,
}

/// A widget placed on the dashboard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct WidgetPlacement {
    /// What names its data and its images, `<type>-<hash>` of its options, so that moving it to another column keeps
    /// what was loaded; a second placement of the same options takes `-2`, and so on.
    pub key: String,
    /// Which widget it is.
    #[serde(rename = "type")]
    pub widget: WidgetType,
    /// The column it sits in, from 1 on the left to 3.
    pub column: u8,
    /// Where its card links to in the browser: `link`, or `https://<container>.<DOMAIN>`; `None` for a widget that
    /// reads no store app.
    pub link: Option<String>,
}

/// The Docker host as Arcane reports it for its first environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArcaneGeneralStats {
    /// Arcane's version, and its newest.
    pub version: ArcaneVersion,
    /// The host's containers.
    pub containers: ContainerCounts,
    /// The host's images.
    pub images: ImageCounts,
    /// The host's volumes.
    pub volumes: VolumeCounts,
    /// What Arcane says needs attention, as images to update.
    pub action_items: Vec<ArcaneActionItem>,
}

/// The version of Arcane, and whether a newer one is out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArcaneVersion {
    /// The version it runs, as it shows it.
    pub current: String,
    /// The newest version out.
    pub newest: String,
    /// Whether `newest` is newer than `current`.
    pub update_available: bool,
    /// The page of the newest release.
    pub release_url: String,
}

/// What Arcane says needs attention.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ArcaneActionItem {
    /// What it is, in snake case, as `image_update`.
    pub kind: String,
    /// How pressing it is: `critical`, `warning`, or another.
    pub severity: String,
    /// How many there are.
    pub count: u64,
}

/// Frigate's latest events, and how its detection runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateEvents {
    /// How many cameras it watches.
    pub camera_count: u64,
    /// How many detections it runs a second, on all its cameras.
    pub detection_fps: f64,
    /// Its detectors, by name.
    pub detectors: Vec<FrigateDetector>,
    /// The latest events, newest first.
    pub events: Vec<FrigateEvent>,
}

/// A detector of Frigate's, and how fast it runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateDetector {
    /// Its name, as Frigate's config gives it.
    pub name: String,
    /// How long one inference takes, in milliseconds.
    pub inference_speed: f64,
}

/// An event of Frigate's: what a camera saw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrigateEvent {
    /// Its id, which is also that of its thumbnail, relayed by `GET /widgets/{key}/image/{id}`.
    pub id: String,
    /// The camera, as `frigate_front_door`.
    pub camera: String,
    /// What was seen, as `person`.
    pub label: String,
    /// What it was recognised as, a face or a plate, when it was.
    pub sub_label: Option<String>,
    /// When it began, in RFC 3339.
    pub start_time: String,
}

/// Where gluetun's tunnel exits: an empty address when it is down, an empty city or country when gluetun could not
/// place it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GluetunVpnStatus {
    /// The public address.
    pub public_ip: String,
    /// The city.
    pub city: String,
    /// The country.
    pub country: String,
}

/// What a widget loaded from its service, by its `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", content = "data", rename_all = "kebab-case")]
#[non_exhaustive]
pub enum WidgetData {
    /// `arcane-general-stats`.
    ArcaneGeneralStats(ArcaneGeneralStats),
    /// `frigate-events`.
    FrigateEvents(FrigateEvents),
    /// `gluetun-vpn-status`.
    GluetunVpnStatus(GluetunVpnStatus),
}

quoll::group! {
    /// The dashboard, as `hangar.yml` places its widgets. A widget's data is kept per placement: fresh for its `ttl`,
    /// 60 seconds unless `hangar.yml` says, then served while it reloads behind the reader for 15 minutes more, which
    /// is also how long a service that stops answering keeps its last card. Nothing is loaded without a reader.
    #[auth(crate::Session)]
    pub group Widgets {
        /// The widgets, in the order `hangar.yml` places them.
        GET "/widgets" => placements() -> Vec<WidgetPlacement>;

        /// What the widget placed as `key` loaded. A 404 for a key the dashboard does not place, or that of a widget
        /// that loads nothing, the clock's or Docker's; a 502 when its service did not answer.
        GET "/widgets/{key}" => data(key: &str) -> WidgetData;

        /// An image the widget placed as `key` shows, fetched from its service: a Frigate thumbnail, a Jellyfin
        /// poster, a card of tcg-collector. Kept a day by the browser. A 404 for an id that is not letters, digits,
        /// `_`, `.` and `-`, or that its service does not have.
        GET "/widgets/{key}/image/{id}" => image(key: &str, id: &str) -> Bytes;
    }
}
