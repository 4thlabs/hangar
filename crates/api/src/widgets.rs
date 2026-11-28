//! The dashboard: the widgets `hangar.yml` places. What each shows, its card reads from its service, through the
//! routes of `Services`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Which widget a placement is, its `type` in `hangar.yml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WidgetType {
    /// The date and time, from the reader's own clock: it reads no service.
    Clock,
    /// The usage of the Docker host, which the page reads from the Docker routes: it reads no service.
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
    /// What its card's reads and images go by, `<type>-<hash>` of its options, so that moving it to another column keeps
    /// what was read; a second placement of the same options takes `-2`, and so on.
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

quoll::group! {
    /// The dashboard, as `hangar.yml` places its widgets.
    #[auth(crate::Session)]
    pub group Widgets {
        /// The widgets, in the order `hangar.yml` places them.
        GET "/widgets" => placements() -> Vec<WidgetPlacement>;
    }
}
