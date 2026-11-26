//! Docker: the installed apps as the daemon runs them, compose projects of services and containers, their logs and
//! their resource usage, the usage of the whole host, and what changed, for the page to read again.

use std::collections::BTreeMap;

use quoll::Events;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// How a compose project, or one of its services, runs as a whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    /// Every container runs, and none is unhealthy.
    Running,
    /// Some containers run, others not, and none is unhealthy.
    Partial,
    /// No container runs, or there is none.
    Stopped,
    /// At least one container is unhealthy, whatever the others do.
    Unhealthy,
}

/// What a container is doing, as the daemon reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContainerState {
    /// Created, never started.
    Created,
    /// Running.
    Running,
    /// Paused.
    Paused,
    /// Being restarted by the daemon.
    Restarting,
    /// Stopped.
    Exited,
    /// Being removed.
    Removing,
    /// Stopped after the daemon failed to stop or remove it.
    Dead,
    /// A state the daemon did not name, or one newer than Hangar.
    Unknown,
}

/// What the healthcheck of a container says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContainerHealth {
    /// Not checked yet, within the start period.
    Starting,
    /// The last checks passed.
    Healthy,
    /// The last checks failed.
    Unhealthy,
}

/// A port that a container publishes on the host.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublishedPort {
    /// The host address it is bound to, such as `0.0.0.0` or `::`.
    pub ip: Option<String>,
    /// The port inside the container.
    pub private_port: u16,
    /// The port on the host.
    pub public_port: u16,
    /// `tcp`, `udp` or `sctp`.
    pub protocol: String,
}

/// A container of a compose service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContainer {
    /// The full container id.
    pub id: String,
    /// Its name, as `alpha-web-1`.
    pub name: String,
    /// The compose service it is a replica of.
    pub service: String,
    /// Its index among the replicas of its service, from 1, when compose gave it a readable one.
    pub replica: Option<u32>,
    /// The image as compose runs it, such as `nginx:alpine`.
    pub image: String,
    /// What it is doing.
    pub state: ContainerState,
    /// What its healthcheck says; `None` when it declares none, or the daemon does not say.
    pub health: Option<ContainerHealth>,
    /// How many times the daemon restarted it; `None` when the daemon does not say.
    pub restart_count: Option<u64>,
    /// The ports it publishes on the host, by host port.
    pub ports: Vec<PublishedPort>,
}

/// A compose service: the replicas of one container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectService {
    /// The service's name.
    pub name: String,
    /// How it runs as a whole.
    pub status: ProjectStatus,
    /// How many of its containers run.
    pub running_count: usize,
    /// How many of its containers are unhealthy.
    pub unhealthy_count: usize,
    /// Its containers, by replica index.
    pub containers: Vec<ProjectContainer>,
}

/// The category of `hangar.yml` an app is filed under.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct AppCategory {
    /// Its name.
    pub name: String,
    /// Its color, as `hangar.yml` writes it.
    pub color: String,
}

/// An installed app as the daemon runs it, in a line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    /// The app's id, its compose project.
    pub name: String,
    /// The URL of its icon, `x-hangar.icon`.
    pub icon: Option<String>,
    /// The first category of `hangar.yml` that lists it.
    pub category: Option<AppCategory>,
    /// How it runs as a whole.
    pub status: ProjectStatus,
    /// How many services its containers belong to.
    pub service_count: usize,
    /// How many of its containers run.
    pub running_count: usize,
    /// How many of its containers are unhealthy.
    pub unhealthy_count: usize,
    /// The full ids of its containers, which pick its rows out of the stats.
    pub container_ids: Vec<String>,
}

/// An installed app as the daemon runs it, with its services and their containers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProjectDetail {
    /// The app in a line.
    pub summary: ProjectSummary,
    /// Its services, by name; none before its first start.
    pub services: Vec<ProjectService>,
}

/// The resource usage of a container at a point in time. A figure is `None` when the daemon gave too little to compute
/// it, rather than a misleading zero.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContainerMetrics {
    /// Its share of the host's CPU time since the previous frame, 100 per core it uses; `None` in the first frame.
    pub cpu_percent: Option<f64>,
    /// The memory it holds, in bytes, without the page cache.
    pub memory_usage: Option<u64>,
    /// The memory it may hold, in bytes.
    pub memory_limit: Option<u64>,
    /// `memoryUsage` as a share of `memoryLimit`, out of 100.
    pub memory_percent: Option<f64>,
    /// The bytes it received, on all its networks.
    pub network_rx: Option<u64>,
    /// The bytes it sent, on all its networks.
    pub network_tx: Option<u64>,
    /// The bytes it read, on all its block devices.
    pub block_read: Option<u64>,
    /// The bytes it wrote, on all its block devices.
    pub block_write: Option<u64>,
}

/// The resource usage of the running containers of every compose project on the host, those of apps Hangar did not
/// install among them: a page keeps the ids its apps list.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
pub struct StatsFrame {
    /// The metrics of each running container, by full container id.
    pub containers: BTreeMap<String, ContainerMetrics>,
}

/// An event of a container's followed log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LogEvent {
    /// A line, which starts with the time the daemon read it, as `2026-11-24T10:00:00.000000000Z ready`.
    Line {
        /// The line, without its line break.
        line: String,
    },
    /// The last event: the container stopped, and its log has nothing more.
    End,
}

/// How many containers the host has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
pub struct ContainerCounts {
    /// Every container, in any state.
    pub total: u64,
    /// The running ones.
    pub running: u64,
    /// The stopped ones.
    pub stopped: u64,
}

/// How many images the host has, and the disk they take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
pub struct ImageCounts {
    /// Every image.
    pub total: u64,
    /// The images no container uses.
    pub unused: u64,
    /// The bytes their layers take, each layer once.
    pub size: u64,
}

/// How many volumes the host has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VolumeCounts {
    /// Every volume.
    pub total: u64,
    /// The volumes a container mounts.
    pub in_use: u64,
    /// The others.
    pub unused: u64,
}

/// The usage of the whole host: every container, image and volume of the daemon, not only those of Hangar's apps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DockerOverview {
    /// The daemon's version.
    pub version: String,
    /// The memory of the host, in bytes: what a container with no limit of its own may take, and the limit its stats
    /// report.
    pub memory: u64,
    /// Its containers.
    pub containers: ContainerCounts,
    /// Its images.
    pub images: ImageCounts,
    /// Its volumes.
    pub volumes: VolumeCounts,
}

/// What the daemon changed, which a page that shows it reads again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DockerChange {
    /// The apps: their containers, or which of them are installed, and how `hangar.yml` files them. The projects and each
    /// project's detail.
    Containers,
    /// The usage of the whole host.
    Overview,
}

quoll::group! {
    /// The installed apps as the daemon runs them, read from the server's cache, which the daemon's events keep fresh.
    #[auth(crate::Session)]
    pub group Docker {
        /// Every installed app, by name, with no container yet or not: one never started is stopped.
        GET "/docker/apps" => projects() -> Vec<ProjectSummary>;

        /// An installed app with its services and containers. A 404 for an app that is not installed.
        GET "/docker/apps/{project}" => project(project: &str) -> ProjectDetail;

        /// The log of a container of an app, followed: its last 200 lines, then each new one, and an `end` once the
        /// container stops. A 404 for an id that is not that of a container of the app, 12 to 64 hexadecimal digits.
        GET "/docker/apps/{project}/containers/{container}/logs"
            => logs(project: &str, container: &str) -> Events<LogEvent>;

        /// The resource usage of the running containers of every compose project, a frame every second. Each stream
        /// measures its CPU shares from its own samples: the first frame has none. It does not end; a daemon that fails
        /// ends it with a problem.
        GET "/docker/stats" => stats() -> Events<StatsFrame>;

        /// The usage of the whole host.
        GET "/docker/overview" => overview() -> DockerOverview;

        /// What the daemon changed, once the server's cache holds it: a page reads again what it shows. What changed
        /// before the stream opened is not in it, so a page reads everything again once it is open. It does not end.
        GET "/docker/changes" => changes() -> Events<DockerChange>;
    }
}
