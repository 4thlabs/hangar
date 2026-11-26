//! What the core reads of Docker becomes on the wire, with what the store adds to it: each app's icon and category.

use hangar_api::{
    AppCategory, ContainerCounts, ContainerHealth, ContainerMetrics, ContainerState,
    DockerOverview, ImageCounts, ProjectContainer, ProjectDetail, ProjectService, ProjectStatus,
    ProjectSummary, PublishedPort, StatsFrame, VolumeCounts,
};
use hangar_core::{Category, StoreApp};

/// What the store knows of the installed apps that Docker does not: their icons, and the categories of `hangar.yml`.
pub(crate) struct Installed {
    pub(crate) apps: Vec<StoreApp>,
    pub(crate) categories: Vec<Category>,
}

impl Installed {
    /// The ids of the installed apps, their compose projects.
    pub(crate) fn ids(&self) -> impl Iterator<Item = &str> {
        self.apps.iter().map(|app| app.id.as_str())
    }

    /// `summary`, with the icon of its app and the first category that lists it: nothing stops `hangar.yml` from
    /// listing an app twice.
    pub(crate) fn summary(&self, summary: hangar_core::ComposeProjectSummary) -> ProjectSummary {
        let icon = self
            .apps
            .iter()
            .find(|app| app.id == summary.name)
            .and_then(|app| app.icon.clone());
        let category = self
            .categories
            .iter()
            .find(|category| category.stacks.contains(&summary.name))
            .map(|category| AppCategory {
                name: category.name.clone(),
                color: category.color.clone(),
            });

        ProjectSummary {
            name: summary.name,
            icon,
            category,
            status: Views::status(summary.status),
            service_count: summary.service_count,
            running_count: summary.running_count,
            unhealthy_count: summary.unhealthy_count,
            container_ids: summary.container_ids,
        }
    }

    /// `detail`, its summary with what the store adds.
    pub(crate) fn detail(&self, detail: hangar_core::ComposeProjectDetail) -> ProjectDetail {
        ProjectDetail {
            summary: self.summary(detail.summary),
            services: detail.services.into_iter().map(Views::service).collect(),
        }
    }
}

/// The conversions of what the core reads.
pub(crate) struct Views;

impl Views {
    fn status(status: hangar_core::ProjectStatus) -> ProjectStatus {
        match status {
            hangar_core::ProjectStatus::Running => ProjectStatus::Running,
            hangar_core::ProjectStatus::Partial => ProjectStatus::Partial,
            hangar_core::ProjectStatus::Stopped => ProjectStatus::Stopped,
            hangar_core::ProjectStatus::Unhealthy => ProjectStatus::Unhealthy,
        }
    }

    fn service(service: hangar_core::ComposeService) -> ProjectService {
        ProjectService {
            name: service.name,
            status: Self::status(service.status),
            running_count: service.running_count,
            unhealthy_count: service.unhealthy_count,
            containers: service
                .containers
                .into_iter()
                .map(Self::container)
                .collect(),
        }
    }

    fn container(container: hangar_core::ComposeContainer) -> ProjectContainer {
        ProjectContainer {
            health: container.health().map(Self::health),
            restart_count: container.details.and_then(|details| details.restart_count),
            state: Self::state(container.state),
            ports: container
                .ports
                .into_iter()
                .map(|port| PublishedPort {
                    ip: port.ip,
                    private_port: port.private_port,
                    public_port: port.public_port,
                    protocol: port.protocol,
                })
                .collect(),
            id: container.id,
            name: container.name,
            service: container.service,
            replica: container.replica,
            image: container.image,
        }
    }

    fn state(state: hangar_core::ContainerState) -> ContainerState {
        match state {
            hangar_core::ContainerState::Created => ContainerState::Created,
            hangar_core::ContainerState::Running => ContainerState::Running,
            hangar_core::ContainerState::Paused => ContainerState::Paused,
            hangar_core::ContainerState::Restarting => ContainerState::Restarting,
            hangar_core::ContainerState::Exited => ContainerState::Exited,
            hangar_core::ContainerState::Removing => ContainerState::Removing,
            hangar_core::ContainerState::Dead => ContainerState::Dead,
            hangar_core::ContainerState::Unknown => ContainerState::Unknown,
        }
    }

    fn health(health: hangar_core::Health) -> ContainerHealth {
        match health {
            hangar_core::Health::Starting => ContainerHealth::Starting,
            hangar_core::Health::Healthy => ContainerHealth::Healthy,
            hangar_core::Health::Unhealthy => ContainerHealth::Unhealthy,
        }
    }

    /// A frame of the core's stats.
    pub(crate) fn frame(frame: hangar_core::StatsFrame) -> StatsFrame {
        let containers = frame
            .into_iter()
            .map(|(id, metrics)| {
                let metrics = ContainerMetrics {
                    cpu_percent: metrics.cpu_percent,
                    memory_usage: metrics.memory_usage,
                    memory_limit: metrics.memory_limit,
                    memory_percent: metrics.memory_percent,
                    network_rx: metrics.network_rx,
                    network_tx: metrics.network_tx,
                    block_read: metrics.block_read,
                    block_write: metrics.block_write,
                };

                (id, metrics)
            })
            .collect();

        StatsFrame { containers }
    }

    /// The core's overview.
    pub(crate) fn overview(overview: &hangar_core::DockerOverview) -> DockerOverview {
        let hangar_core::DockerOverview {
            version,
            memory,
            containers,
            images,
            volumes,
        } = overview;

        DockerOverview {
            version: version.clone(),
            memory: *memory,
            containers: ContainerCounts {
                total: containers.total,
                running: containers.running,
                stopped: containers.stopped,
            },
            images: ImageCounts {
                total: images.total,
                unused: images.unused,
                size: images.size,
            },
            volumes: VolumeCounts {
                total: volumes.total,
                in_use: volumes.in_use,
                unused: volumes.unused,
            },
        }
    }
}
