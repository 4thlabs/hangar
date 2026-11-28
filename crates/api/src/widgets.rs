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
    /// The newest version out; `None` when Arcane does not know it, as when its checks are off.
    pub newest: Option<String>,
    /// Whether `newest` is newer than `current`.
    pub update_available: bool,
    /// The page of the newest release, when Arcane gives it.
    pub release_url: Option<String>,
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

/// Backrest's repositories, and how their backups went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BackrestSummary {
    /// Its repositories, in Backrest's order.
    pub repositories: Vec<BackrestRepository>,
}

/// A repository of Backrest's, and its last backup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackrestRepository {
    /// Its id.
    pub id: String,
    /// How its last backup ended, as `SUCCESS` or `ERROR`; `None` before its first.
    pub status: Option<String>,
    /// Whether its last backup succeeded.
    pub health: BackrestHealth,
    /// When its last backup ran, in RFC 3339.
    pub last_run_at: Option<String>,
    /// How many backups succeeded in the last 30 days.
    pub successes: u64,
    /// The bytes its backups added in the last 30 days.
    pub bytes_added: u64,
    /// The bytes it protects.
    pub protected_bytes: u64,
    /// When its next backup runs, in RFC 3339, when one is planned.
    pub next_backup_at: Option<String>,
}

/// How the last backup of a repository went: only a success is healthy, as on Backrest's own dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackrestHealth {
    /// It has not run yet.
    NeverRun,
    /// It succeeded.
    Healthy,
    /// It did not.
    Failed,
}

/// The systems a Beszel hub monitors, as its agents last reported them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct BeszelServerStats {
    /// Its systems, by name.
    pub systems: Vec<BeszelSystem>,
}

/// A system Beszel monitors. Its readings are those of the last report, 0 when it gave none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BeszelSystem {
    /// Its id in the hub.
    pub id: String,
    /// Its name.
    pub name: String,
    /// `up`, `down`, `paused` or `pending`.
    pub status: String,
    /// Whether it is `up`, the only status whose readings are current.
    pub up: bool,
    /// How long it has run, in seconds, when it reported it.
    pub uptime: Option<u64>,
    /// The CPU it uses, out of 100.
    pub cpu: f64,
    /// The memory it uses, out of 100.
    pub memory: f64,
    /// The root disk it uses, out of 100.
    pub disk: f64,
    /// Its hottest sensor, in °C, when it has one.
    pub temperature: Option<f64>,
    /// Its CPU's model, when it reported it.
    pub cpu_model: Option<String>,
}

/// What Forgejo Actions runs, and the repositories updated last.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoCi {
    /// How many repositories the card covers.
    pub repository_count: u64,
    /// Every run not finished yet, running ones first, then newest first.
    pub active_runs: Vec<ForgejoRun>,
    /// The three repositories updated last, newest first, archived ones left out.
    pub recent_repositories: Vec<ForgejoRepository>,
}

/// A run of Forgejo Actions that has not finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoRun {
    /// Its id.
    pub id: u64,
    /// The repository it runs in, `owner/name`.
    pub repository: String,
    /// The title of the commit or pull request it runs for.
    pub title: String,
    /// `running`, `waiting` or `blocked`.
    pub status: String,
    /// Whether it waits for a runner or an approval, rather than runs.
    pub is_queued: bool,
    /// The branch, tag or pull request it runs on, as `main` or `#2`.
    pub reference: String,
    /// Its page.
    pub url: String,
    /// When it started, or, until it does, when it was queued, in RFC 3339.
    pub since: String,
}

/// A repository of Forgejo's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoRepository {
    /// `owner/name`.
    pub full_name: String,
    /// Its page.
    pub url: String,
    /// When it was pushed to or changed last, in RFC 3339.
    pub updated_at: String,
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

/// Miniflux's newest entries, and how many are unread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct MinifluxEntries {
    /// How many entries are unread, in every feed.
    pub unread: u64,
    /// The newest entries, read or not, newest first.
    pub entries: Vec<MinifluxEntry>,
}

/// An entry of a feed of Miniflux's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MinifluxEntry {
    /// Its id.
    pub id: u64,
    /// Its title.
    pub title: String,
    /// The page it links to.
    pub url: String,
    /// The title of its feed.
    pub feed_title: String,
    /// When it was published, in RFC 3339, as Miniflux writes it.
    pub published_at: String,
    /// Whether it is unread.
    pub is_unread: bool,
}

/// The prices of the cards tcg-collector follows, in euros, from Cardmarket's price guides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TcgCollectorCards {
    /// How many days the price curves cover.
    pub days: u16,
    /// The cards, in the order `hangar.yml` lists them.
    pub cards: Vec<TcgFollowedCard>,
}

/// A card tcg-collector follows: a version of it, by its Cardmarket ids.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TcgFollowedCard {
    /// Cardmarket's game id: 1 for Magic, 21 for Star Wars Unlimited.
    pub game: u32,
    /// Cardmarket's product id, of this version of the card.
    pub product: u32,
    /// The id of its image, relayed by `GET /widgets/{key}/image/{id}`.
    pub image_id: String,
    /// The card, `None` when tcg-collector does not know the product.
    pub card: Option<TcgCard>,
    /// Its prices over the days of the curve, oldest first, from the first day that has one.
    pub history: Vec<TcgDailyPrices>,
}

/// A product of a game's catalog, with its latest prices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TcgCard {
    /// Its name.
    pub name: String,
    /// Its expansion.
    pub expansion: Option<String>,
    /// 1, 2... when its expansion has several products of its name, Cardmarket's V.1, V.2...
    pub version: Option<u32>,
    /// Its trend price.
    pub trend: Option<f64>,
    /// Its lowest price.
    pub low: Option<f64>,
    /// The trend price of its foil.
    pub trend_foil: Option<f64>,
}

/// A day of a card's prices. A day without a new price guide repeats the day before.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TcgDailyPrices {
    /// The day, `YYYY-MM-DD`.
    pub day: String,
    /// The trend price.
    pub trend: Option<f64>,
    /// The lowest price.
    pub low: Option<f64>,
}

/// The latest release of each repository of the widget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct GithubReleases {
    /// The releases, newest first: a repository with none, renamed, or private is left out.
    pub releases: Vec<GithubRelease>,
}

/// A release of a GitHub repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    /// The repository, `owner/repo`, as `hangar.yml` names it.
    pub repository: String,
    /// The release's tag, as `v1.2.3`.
    pub tag: String,
    /// The release's page.
    pub url: String,
    /// When it was published, in RFC 3339.
    pub published_at: String,
}

/// Stock quotes from Finnhub, in the order the widget lists them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct StockPrices {
    /// The stocks: a symbol Finnhub cannot quote is left out.
    pub stocks: Vec<Stock>,
}

/// A stock, as Finnhub quotes it, in the currency it is quoted in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    /// Its symbol, as `hangar.yml` writes it.
    pub symbol: String,
    /// The company's name; `None` when Finnhub has no profile of it.
    pub name: Option<String>,
    /// The ISO 4217 code of the currency it is quoted in; `None` when Finnhub has no profile of it.
    pub currency: Option<String>,
    /// Its last price.
    pub price: f64,
    /// Its change since the previous close, in percent.
    pub change_percent: f64,
    /// The day's high.
    pub high: f64,
    /// The day's low.
    pub low: f64,
    /// The day's open.
    pub open: f64,
    /// Its daily closes over the last month, oldest first; none when Finnhub's plan gives none.
    pub closes: Vec<f64>,
}

/// What a widget loaded from its service, by its `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", content = "data", rename_all = "kebab-case")]
#[non_exhaustive]
pub enum WidgetData {
    /// `arcane-general-stats`.
    ArcaneGeneralStats(ArcaneGeneralStats),
    /// `backrest-summary`.
    BackrestSummary(BackrestSummary),
    /// `beszel-server-stats`.
    BeszelServerStats(BeszelServerStats),
    /// `forgejo-ci`.
    ForgejoCi(ForgejoCi),
    /// `frigate-events`.
    FrigateEvents(FrigateEvents),
    /// `gluetun-vpn-status`.
    GluetunVpnStatus(GluetunVpnStatus),
    /// `miniflux-entries`.
    MinifluxEntries(MinifluxEntries),
    /// `tcg-collector-cards`.
    TcgCollectorCards(TcgCollectorCards),
    /// `github-releases`.
    GithubReleases(GithubReleases),
    /// `stock-prices`.
    StockPrices(StockPrices),
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

        /// An image the widget placed as `key` shows, fetched from its service: a Frigate thumbnail, a card of
        /// tcg-collector. Kept a day by the browser. A 404 for an id that is not letters, digits,
        /// `_`, `.` and `-`, or that its service does not have.
        GET "/widgets/{key}/image/{id}" => image(key: &str, id: &str) -> Bytes;
    }
}
