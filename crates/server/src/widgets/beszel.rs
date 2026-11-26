//! `beszel-server-stats`: the systems a Beszel hub monitors, from its PocketBase.

use hangar_api::{BeszelServerStats, BeszelSystem};
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// The PocketBase of a Beszel hub, under `/api`. Its key, a Beszel API token, goes in `Authorization` as it is:
    /// PocketBase reads a raw token there.
    #[server(none)]
    api BeszelApi = "/api";

    group Beszel {
        GET "/collections/systems/records?sort={sort}&fields={fields}&perPage={per_page}"
            => systems(sort: &str, fields: &str, per_page: u32) -> Page<System>;
    }
}

/// A page of a collection: PocketBase pages every list.
#[derive(Debug, Deserialize)]
struct Page<T> {
    items: Vec<T>,
}

/// A system, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct System {
    id: String,
    name: String,
    status: String,
    /// Empty, or missing, for a system that never reported.
    #[serde(default)]
    info: Info,
}

/// What the agent of a system last reported, under Beszel's one-letter keys.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Info {
    /// The uptime, in seconds.
    u: Option<f64>,
    /// The CPU used, out of 100.
    cpu: Option<f64>,
    /// The memory used, out of 100.
    mp: Option<f64>,
    /// The root disk used, out of 100.
    dp: Option<f64>,
    /// The hottest sensor, in °C.
    dt: Option<f64>,
    /// The CPU's model.
    m: Option<String>,
}

/// The fields of a system the card reads, the only ones asked for.
const FIELDS: &str = "id,name,status,info";

/// More systems than a hub monitors, on one page.
const PER_PAGE: u32 = 100;

/// The status of a system whose readings are current.
const UP: &str = "up";

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(BeszelApiClient);

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

/// The client of the Beszel hub of `service`, which sends its token as the whole of `Authorization`, written by hand:
/// quoll leaves that header to its `Bearer` and `Basic`.
///
/// # Errors
///
/// When the token cannot go in a header, as one with a line break.
fn build(service: &Service) -> Result<BeszelApiClient, LoadError> {
    let Some(token) = service.key() else {
        return service.keyless_client::<BeszelApi>("Beszel");
    };

    service.client::<BeszelApi>("Beszel", Some(Service::authorization(token, "Beszel")?))
}

/// The systems of the Beszel hub of `client`, by name, as the hub's own page lists them.
pub(super) async fn load(client: &Client) -> Result<BeszelServerStats, LoadError> {
    let page = client
        .0
        .beszel()
        .systems("name", FIELDS, PER_PAGE)
        .await
        .map_err(LoadError::call("list Beszel's systems"))?;

    Ok(BeszelServerStats {
        systems: page
            .items
            .into_iter()
            .map(|system| BeszelSystem {
                up: system.status == UP,
                id: system.id,
                name: system.name,
                status: system.status,
                // Whole seconds: an agent reports them so, and a float the page would round anyway.
                uptime: system.info.u.map(|seconds| seconds.max(0.0) as u64),
                cpu: system.info.cpu.unwrap_or_default(),
                memory: system.info.mp.unwrap_or_default(),
                disk: system.info.dp.unwrap_or_default(),
                temperature: system.info.dt,
                cpu_model: system.info.m,
            })
            .collect(),
    })
}
