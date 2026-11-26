//! The usage of the whole host, as the daemon's info and its disk usage report it.

use super::engine::{DiskUsage, SystemInfo, Usage as _};
use super::{Docker, DockerError};

/// The usage of the whole host: every container, image and volume the daemon has, not only those of Hangar's apps.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DockerOverview {
    /// The daemon's version, as `29.0.1`.
    pub version: String,
    /// The memory of the host, in bytes: what a container with no limit of its own may take.
    pub memory: u64,
    /// Its containers.
    pub containers: ContainerCounts,
    /// Its images.
    pub images: ImageCounts,
    /// Its volumes.
    pub volumes: VolumeCounts,
}

/// How many containers the daemon has, in all and by what they do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct ContainerCounts {
    /// Every container, in any state.
    pub total: u64,
    /// The running ones.
    pub running: u64,
    /// The stopped ones; with the running ones, not every container: a paused one is neither.
    pub stopped: u64,
}

/// How many images the daemon has, and the disk they take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct ImageCounts {
    /// Every image.
    pub total: u64,
    /// The images no container uses.
    pub unused: u64,
    /// The bytes their layers take, each layer once however many images share it.
    pub size: u64,
}

/// How many volumes the daemon has, and how many are mounted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct VolumeCounts {
    /// Every volume.
    pub total: u64,
    /// The volumes a container mounts, running or not.
    pub in_use: u64,
    /// The others.
    pub unused: u64,
}

impl DockerOverview {
    /// The overview of what the daemon's info and disk usage say.
    fn new(info: SystemInfo, usage: DiskUsage) -> Self {
        let count = |count: usize| count as u64;
        let in_use = count(
            usage
                .volumes
                .iter()
                .filter(|volume| {
                    volume
                        .usage_data
                        .as_ref()
                        .is_some_and(|data| data.ref_count > 0)
                })
                .count(),
        );
        let volumes = count(usage.volumes.len());

        Self {
            version: info.server_version,
            memory: info.mem_total,
            containers: ContainerCounts {
                total: info.containers,
                running: info.containers_running,
                stopped: info.containers_stopped,
            },
            images: ImageCounts {
                total: count(usage.images.len()),
                unused: count(
                    usage
                        .images
                        .iter()
                        .filter(|image| image.containers == 0)
                        .count(),
                ),
                size: usage.layers_size,
            },
            volumes: VolumeCounts {
                total: volumes,
                in_use,
                unused: volumes - in_use,
            },
        }
    }
}

impl Docker {
    /// The usage of the whole host, from the daemon's info and its disk usage, both asked at once. The disk usage is
    /// the daemon's slowest call, which sizes every image and volume: a caller that reads it often keeps it.
    ///
    /// # Errors
    ///
    /// [`DockerError::Daemon`] when the daemon does not answer either call.
    pub async fn overview(&self) -> Result<DockerOverview, DockerError> {
        let usage = self.engine.usage();
        let (info, disk_usage) = tokio::join!(usage.info(), usage.disk_usage());
        let info = info.map_err(|error| DockerError::daemon("read the daemon's info", error))?;
        let disk_usage = disk_usage
            .map_err(|error| DockerError::daemon("read the daemon's disk usage", error))?;

        Ok(DockerOverview::new(info, disk_usage))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_the_containers_the_images_and_the_volumes_of_the_host() {
        let info: SystemInfo = serde_json::from_value(serde_json::json!({
            "ServerVersion": "29.0.1",
            "Containers": 5,
            "ContainersRunning": 3,
            "ContainersPaused": 1,
            "ContainersStopped": 1,
            "MemTotal": 16_000,
        }))
        .expect("an info");
        let usage: DiskUsage = serde_json::from_value(serde_json::json!({
            "LayersSize": 1_000,
            "Images": [{ "Containers": 2 }, { "Containers": 0 }, { "Containers": 0 }],
            "Volumes": [
                { "UsageData": { "RefCount": 1 } },
                { "UsageData": { "RefCount": 0 } },
                { "UsageData": { "RefCount": -1 } },
                { "UsageData": null },
            ],
        }))
        .expect("a disk usage");

        assert_eq!(
            DockerOverview::new(info, usage),
            DockerOverview {
                version: "29.0.1".to_owned(),
                memory: 16_000,
                containers: ContainerCounts {
                    total: 5,
                    running: 3,
                    stopped: 1,
                },
                images: ImageCounts {
                    total: 3,
                    unused: 2,
                    size: 1_000,
                },
                volumes: VolumeCounts {
                    total: 4,
                    in_use: 1,
                    unused: 3,
                },
            }
        );
    }
}
