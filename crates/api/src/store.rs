//! The store: its clone, installed or updated from its git URL apart from the request, and its apps, installed or not.

use quoll::Accepted;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The store as the settings show it: where it comes from, whether it is cloned, and its last sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StoreStatus {
    /// The git URL of the store, `HANGAR_STORE_URL`.
    pub url: String,
    /// Whether the store's repository is cloned in the data directory.
    pub installed: bool,
    /// The last sync since the server started, running or ended; `None` before the first.
    pub sync: Option<StoreSync>,
}

/// A clone or a pull of the store, which runs apart from the request that starts it, one at a time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StoreSync {
    /// A clone, for a store not cloned yet, or a pull with `--ff-only`.
    pub operation: SyncOperation,
    /// Where it is.
    pub state: SyncState,
    /// When it started, in RFC 3339.
    pub started_at: String,
    /// When it ended, in RFC 3339; `None` while it runs.
    pub finished_at: Option<String>,
    /// Why it failed, in English, without git's output, which the server's log holds; `None` unless it failed.
    pub error: Option<String>,
}

/// What a sync does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyncOperation {
    /// Clones the store, which is not there yet.
    Install,
    /// Pulls the store, with `--ff-only`.
    Update,
}

/// Where a sync is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyncState {
    /// It runs.
    Running,
    /// It ended well: the apps `hangar.yml` lists are linked, and `.env.global` seeded.
    Succeeded,
    /// It failed: its `error` says why.
    Failed,
}

/// Which of the store's apps a listing keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppFilter {
    /// The apps linked into `app-installed/`.
    Installed,
    /// The apps that are not.
    Available,
}

/// An app of the store, installed or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StoreApp {
    /// Its id: its folder under `store/`, and its compose project.
    pub id: String,
    /// Its display name: `x-hangar.name`, else the compose file's `name`, else its id capitalized.
    pub name: String,
    /// The URL of its icon, `x-hangar.icon`.
    pub icon: Option<String>,
    /// Whether it is installed.
    pub installed: bool,
    /// Whether it ships a `compose.swarm.yml` with content, and can then be deployed in the swarm.
    pub swarm_ready: bool,
}

/// The apps a listing keeps, and how many apps each filter would keep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StoreApps {
    /// The apps the filters keep, by id.
    pub apps: Vec<StoreApp>,
    /// How many of all the store's apps each filter keeps, whatever the filters asked.
    pub counts: AppCounts,
}

/// How many of the store's apps each filter keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct AppCounts {
    /// The apps installed.
    pub installed: usize,
    /// The apps not installed.
    pub available: usize,
}

/// What a new app starts from: its `compose.yml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct NewAppTemplate {
    /// The `compose.yml`: a name, an icon, and a service with its container, what Hangar needs to list the app.
    pub compose: String,
}

quoll::group! {
    /// The store and its apps.
    #[auth(crate::Session)]
    pub group Store {
        /// The store's URL, whether it is cloned, and its last sync.
        GET "/store" => status() -> StoreStatus;

        /// Clones the store, or pulls it once cloned, then links the apps `hangar.yml` lists and seeds `.env.global`,
        /// apart from the request: the sync running, which `GET /store` reads again, and notified once it ends. While
        /// one runs, the answer is that one, and no other starts.
        POST "/store/sync" => sync() -> Accepted<StoreSync>;

        /// The store's apps, by id, those of the filters given, or all of them, and how many each filter keeps.
        GET "/store/apps?filter={filter}" => apps(#[join(",")] filter: Vec<AppFilter>) -> StoreApps;

        /// Installs an app: links it into `app-installed/`, then seeds the variables its files reference. An app
        /// installed already is left as it is. A 404 for an app the store does not carry.
        POST "/store/apps/{id}/install" => install(id: &str) -> StoreApp;

        /// Uninstalls an app: `docker compose down` first, then its link removed; its volumes and its folder in the
        /// store are kept. An app not installed is left as it is. A 404 for an app the store does not carry.
        POST "/store/apps/{id}/uninstall" => uninstall(id: &str) -> StoreApp;

        /// The `compose.yml` a new app starts from.
        GET "/store/new-app" => new_app() -> NewAppTemplate;
    }
}
