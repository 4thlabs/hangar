//! `arcane-general-stats`: the Docker host as Arcane reports it.

use hangar_api::{
    ArcaneActionItem, ArcaneGeneralStats, ArcaneVersion, ContainerCounts, ImageCounts, VolumeCounts,
};
use quoll::client;
use serde::Deserialize;

use super::error::LoadError;
use super::service::Service;

quoll::api! {
    /// Arcane's API, under `/api`.
    #[server(none)]
    api ArcaneApi = "/api";

    /// An Arcane API key.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Arcane {
        GET "/environments/{environment}/dashboard" => dashboard(environment: u32) -> Answer<Dashboard>;
    }
}

/// Every answer of Arcane: a failure still answers 200, with `success` false and no `data`.
#[derive(Debug, Deserialize)]
struct Answer<T> {
    success: bool,
    data: Option<T>,
    detail: Option<String>,
}

/// The dashboard, with the fields the card reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard {
    #[serde(default)]
    version_info: VersionInfo,
    containers: Containers,
    image_usage_counts: ImageUsage,
    volume_usage_counts: VolumeUsage,
    #[serde(default)]
    action_items: ActionItems,
}

/// Arcane leaves out what it does not know, as the newest version when its checks are off or GitHub fails it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VersionInfo {
    update_available: bool,
    release_url: Option<String>,
    display_version: String,
    newest_version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Containers {
    counts: ContainerUsage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerUsage {
    total_containers: u64,
    running_containers: u64,
    stopped_containers: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageUsage {
    total_images: u64,
    images_unused: u64,
    total_image_size: u64,
}

#[derive(Debug, Deserialize)]
struct VolumeUsage {
    total: u64,
    inuse: u64,
    unused: u64,
}

#[derive(Debug, Default, Deserialize)]
struct ActionItems {
    #[serde(default)]
    items: Vec<ActionItem>,
}

#[derive(Debug, Deserialize)]
struct ActionItem {
    kind: String,
    severity: String,
    count: u64,
}

/// Arcane's own host, the only environment the card reads.
const LOCAL_ENVIRONMENT: u32 = 0;

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(ArcaneApiClient);

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

/// The client of the Arcane of `service`, with its key.
fn build(service: &Service) -> Result<ArcaneApiClient, LoadError> {
    service.client::<ArcaneApi>("Arcane", service.key().map(client::key::<ApiKey>))
}

/// The dashboard of the Arcane of `client`, for its own host.
pub(super) async fn load(client: &Client) -> Result<ArcaneGeneralStats, LoadError> {
    let answer = client
        .0
        .arcane()
        .dashboard(LOCAL_ENVIRONMENT)
        .await
        .map_err(LoadError::call("read Arcane's dashboard"))?;
    let dashboard = match answer {
        Answer {
            success: true,
            data: Some(dashboard),
            ..
        } => dashboard,
        Answer { detail, .. } => {
            return Err(LoadError::refused(format!(
                "Arcane refused its dashboard: {}",
                detail.as_deref().unwrap_or("no detail")
            )));
        }
    };
    let Dashboard {
        version_info,
        containers,
        image_usage_counts: images,
        volume_usage_counts: volumes,
        action_items,
    } = dashboard;

    Ok(ArcaneGeneralStats {
        version: ArcaneVersion {
            current: version_info.display_version,
            // A newer version is one Arcane names.
            update_available: version_info.update_available
                && version_info.newest_version.is_some(),
            newest: version_info.newest_version,
            release_url: version_info.release_url,
        },
        containers: ContainerCounts {
            total: containers.counts.total_containers,
            running: containers.counts.running_containers,
            stopped: containers.counts.stopped_containers,
        },
        images: ImageCounts {
            total: images.total_images,
            unused: images.images_unused,
            size: images.total_image_size,
        },
        volumes: VolumeCounts {
            total: volumes.total,
            in_use: volumes.inuse,
            unused: volumes.unused,
        },
        action_items: action_items
            .items
            .into_iter()
            .map(|item| ArcaneActionItem {
                kind: item.kind,
                severity: item.severity,
                count: item.count,
            })
            .collect(),
    })
}
