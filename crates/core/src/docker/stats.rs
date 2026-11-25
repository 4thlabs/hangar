//! The resource usage of the containers of the compose projects, sampled every second.

use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use futures::{Stream, StreamExt, stream};

use super::container::PROJECT_LABEL;
use super::engine::{Containers as _, StatsSample};
use super::{CONCURRENT_CALLS, Docker, DockerError};

/// How often a frame goes out, and so the window the CPU share is measured over.
const INTERVAL: Duration = Duration::from_secs(1);

/// The counter of the page cache, with cgroup v2.
const INACTIVE_FILE: &str = "inactive_file";

/// The counter of the page cache, with cgroup v1.
const TOTAL_INACTIVE_FILE: &str = "total_inactive_file";

/// The resource usage of a container at a point in time. A figure is missing when the daemon gave too little to
/// compute it, rather than a misleading zero.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ContainerMetrics {
    /// Its share of the host's CPU time since the previous frame, 100 per core it uses.
    pub cpu_percent: Option<f64>,
    /// The memory it holds, in bytes, without the page cache.
    pub memory_usage: Option<u64>,
    /// The memory it may hold, in bytes.
    pub memory_limit: Option<u64>,
    /// `memory_usage` as a share of `memory_limit`, out of 100.
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

/// The metrics of every running container of a compose project, by full container id.
pub type StatsFrame = BTreeMap<String, ContainerMetrics>;

/// The samples of the running containers, by full container id.
type Samples = HashMap<String, StatsSample>;

/// A direction of the network.
#[derive(Clone, Copy)]
enum Direction {
    Received,
    Sent,
}

/// Where the sampling is: the samples of the last frame, which the CPU share of the next is measured from.
struct Sampling {
    docker: Docker,
    /// The samples taken before the stream started, for its first frame.
    first: Option<Samples>,
    previous: Samples,
    has_failed: bool,
}

impl ContainerMetrics {
    /// The usage that `sample` says, with the CPU share measured since `previous`, the sample before it.
    pub(crate) fn new(sample: &StatsSample, previous: Option<&StatsSample>) -> Self {
        let memory_usage = Self::memory_usage(sample);
        let memory_limit = sample.memory_stats.limit;

        Self {
            cpu_percent: previous.and_then(|previous| Self::cpu_percent(sample, previous)),
            memory_usage,
            memory_limit,
            memory_percent: Self::share(memory_usage, memory_limit),
            network_rx: Self::network(sample, Direction::Received),
            network_tx: Self::network(sample, Direction::Sent),
            block_read: Self::block_io(sample, "read"),
            block_write: Self::block_io(sample, "write"),
        }
    }

    /// CPU time is a counter, so a share exists only between two samples: the container's own time over the host's,
    /// scaled by the cores it may use. A restarted container starts its counter again, which reads as no share
    /// rather than a negative one.
    fn cpu_percent(sample: &StatsSample, previous: &StatsSample) -> Option<f64> {
        let current = &sample.cpu_stats;
        let used = current
            .cpu_usage
            .total_usage?
            .checked_sub(previous.cpu_stats.cpu_usage.total_usage?)?;
        let available = current
            .system_cpu_usage?
            .checked_sub(previous.cpu_stats.system_cpu_usage?)
            .filter(|available| *available > 0)?;
        let cores = current
            .online_cpus
            .filter(|cores| *cores > 0)
            .map(u64::from)
            .or_else(|| {
                current
                    .cpu_usage
                    .percpu_usage
                    .as_ref()
                    .map(|cores| cores.len() as u64)
                    .filter(|cores| *cores > 0)
            })
            .unwrap_or(1);

        Some(used as f64 / available as f64 * cores as f64 * 100.0)
    }

    /// Docker's own figure, without the page cache, which the kernel takes back at will: with it, an idle container
    /// would seem to hold hundreds of megabytes it does not need.
    fn memory_usage(sample: &StatsSample) -> Option<u64> {
        let usage = sample.memory_stats.usage?;
        let counters = &sample.memory_stats.stats;
        let cache = counters
            .get(INACTIVE_FILE)
            .or_else(|| counters.get(TOTAL_INACTIVE_FILE))
            .copied()
            .unwrap_or(0);

        Some(usage.saturating_sub(cache))
    }

    /// `part` out of 100 of `whole`, when both are known and `whole` is not zero.
    fn share(part: Option<u64>, whole: Option<u64>) -> Option<f64> {
        let whole = whole.filter(|whole| *whole > 0)?;

        Some(part? as f64 / whole as f64 * 100.0)
    }

    /// The bytes of one direction, on all the networks of the container; none without a network.
    fn network(sample: &StatsSample, direction: Direction) -> Option<u64> {
        let networks = sample
            .networks
            .as_ref()
            .filter(|networks| !networks.is_empty())?;

        Some(
            networks
                .values()
                .map(|network| match direction {
                    Direction::Received => network.rx_bytes,
                    Direction::Sent => network.tx_bytes,
                })
                .sum(),
        )
    }

    /// The bytes of one operation, on all the block devices of the container. Docker spells the operation in either
    /// case, depending on its version.
    fn block_io(sample: &StatsSample, operation: &str) -> Option<u64> {
        let entries = sample.blkio_stats.io_service_bytes_recursive.as_ref()?;

        Some(
            entries
                .iter()
                .filter(|entry| entry.op.eq_ignore_ascii_case(operation))
                .map(|entry| entry.value)
                .sum(),
        )
    }
}

impl Docker {
    /// The resource usage of every running container of a compose project, a frame every second. Each call measures
    /// its own CPU shares, from its own samples: the first frame has none.
    ///
    /// A frame holds the containers of every compose project on the host, as the frames of Hangar's Waku version do,
    /// those of projects Hangar did not install among them: a caller that shows only its own projects keeps the ids
    /// of their containers, whose [`project`](super::ComposeContainer::project) [`Docker::containers`] gives.
    ///
    /// # Errors
    ///
    /// When the daemon cannot list its containers: the first sample is taken before the stream is returned, so that
    /// a daemon that does not answer is an error rather than an empty stream. The stream ends with an error when a
    /// later sample fails.
    pub async fn stats(
        &self,
    ) -> Result<impl Stream<Item = Result<StatsFrame, DockerError>> + Send + 'static, DockerError>
    {
        let sampling = Sampling {
            first: Some(self.sample_stats().await?),
            docker: self.clone(),
            previous: Samples::new(),
            has_failed: false,
        };

        Ok(stream::unfold(sampling, Self::next_frame))
    }

    /// The next frame, a second after the last.
    async fn next_frame(
        mut sampling: Sampling,
    ) -> Option<(Result<StatsFrame, DockerError>, Sampling)> {
        if sampling.has_failed {
            return None;
        }

        let current = match sampling.first.take() {
            Some(first) => first,
            None => {
                tokio::time::sleep(INTERVAL).await;

                match sampling.docker.sample_stats().await {
                    Ok(current) => current,
                    Err(error) => {
                        sampling.has_failed = true;

                        return Some((Err(error), sampling));
                    }
                }
            }
        };
        let frame = current
            .iter()
            .map(|(id, sample)| {
                (
                    id.clone(),
                    ContainerMetrics::new(sample, sampling.previous.get(id)),
                )
            })
            .collect();

        sampling.previous = current;

        Some((Ok(frame), sampling))
    }

    /// A sample of every running container of a compose project. A container that stops meanwhile is left out.
    async fn sample_stats(&self) -> Result<Samples, DockerError> {
        let running = self
            .list_containers(false, PROJECT_LABEL.to_owned())
            .await?;
        let samples: Vec<_> = stream::iter(running)
            .map(|container| async move {
                let sample = self
                    .engine
                    .containers()
                    .stats(&container.id, false, true)
                    .await;

                (container.id, sample)
            })
            .buffer_unordered(CONCURRENT_CALLS)
            .collect()
            .await;

        Ok(samples
            .into_iter()
            .filter_map(|(id, sample)| match sample {
                Ok(sample) => Some((id, sample)),
                // A container that stopped meanwhile answers 404. Another failure leaves it out of this frame alone,
                // which the next one may have it in again.
                Err(error) => {
                    if !DockerError::is_gone(&error) {
                        tracing::warn!(container = %id, %error, "could not sample a container's usage");
                    }

                    None
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// A sample with the fields the metrics read: `cpu` and `system` nanoseconds of CPU time on 4 cores, 200 bytes of
    /// memory of which 50 of cache, out of 1000, two networks and three entries of block I/O.
    fn sample(cpu: u64, system: u64) -> StatsSample {
        serde_json::from_value(json!({
            "cpu_stats": {
                "cpu_usage": { "total_usage": cpu },
                "system_cpu_usage": system,
                "online_cpus": 4,
            },
            "memory_stats": { "usage": 200, "limit": 1000, "stats": { "inactive_file": 50 } },
            "networks": {
                "eth0": { "rx_bytes": 10, "tx_bytes": 20 },
                "eth1": { "rx_bytes": 5, "tx_bytes": 1 },
            },
            "blkio_stats": {
                "io_service_bytes_recursive": [
                    { "major": 8, "minor": 0, "op": "read", "value": 300 },
                    { "major": 8, "minor": 0, "op": "write", "value": 400 },
                    { "major": 8, "minor": 16, "op": "Read", "value": 7 },
                ],
            },
        }))
        .expect("a sample")
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("a figure");

        assert!(
            (actual - expected).abs() < 1e-9,
            "{actual} is not {expected}"
        );
    }

    #[test]
    fn has_no_cpu_share_for_the_first_sample_having_nothing_to_compare_against() {
        assert_eq!(
            ContainerMetrics::new(&sample(1_000_000, 10_000_000), None).cpu_percent,
            None
        );
    }

    #[test]
    fn measures_the_cpu_share_between_two_samples_scaled_by_the_cores() {
        let previous = sample(1_000_000, 10_000_000);
        // 1% of the host's time over the window, on 4 cores.
        let current = sample(1_100_000, 20_000_000);

        assert_close(
            ContainerMetrics::new(&current, Some(&previous)).cpu_percent,
            4.0,
        );
    }

    #[test]
    fn has_no_cpu_share_once_a_restart_starts_the_counter_again() {
        let previous = sample(5_000_000, 10_000_000);
        let current = sample(10_000, 20_000_000);

        assert_eq!(
            ContainerMetrics::new(&current, Some(&previous)).cpu_percent,
            None
        );
    }

    #[test]
    fn counts_the_cores_listed_when_the_daemon_gives_no_online_count() {
        let mut previous = sample(1_000_000, 10_000_000);
        let mut current = sample(1_100_000, 20_000_000);

        for sample in [&mut previous, &mut current] {
            sample.cpu_stats.online_cpus = None;
            sample.cpu_stats.cpu_usage.percpu_usage = Some(vec![0, 0]);
        }

        assert_close(
            ContainerMetrics::new(&current, Some(&previous)).cpu_percent,
            2.0,
        );
    }

    #[test]
    fn takes_the_page_cache_out_of_the_memory_as_dockers_own_figure_does() {
        let metrics = ContainerMetrics::new(&sample(0, 0), None);

        assert_eq!(metrics.memory_usage, Some(150));
        assert_eq!(metrics.memory_limit, Some(1000));
        assert_close(metrics.memory_percent, 15.0);
    }

    #[test]
    fn reads_the_page_cache_of_cgroup_v1() {
        let mut v1 = sample(0, 0);

        v1.memory_stats.stats = HashMap::from([(TOTAL_INACTIVE_FILE.to_owned(), 50)]);

        assert_eq!(ContainerMetrics::new(&v1, None).memory_usage, Some(150));
    }

    #[test]
    fn sums_every_network_and_every_block_device() {
        let metrics = ContainerMetrics::new(&sample(0, 0), None);

        assert_eq!(metrics.network_rx, Some(15));
        assert_eq!(metrics.network_tx, Some(21));
        assert_eq!(metrics.block_read, Some(307));
        assert_eq!(metrics.block_write, Some(400));
    }

    #[test]
    fn has_no_figure_rather_than_a_zero_when_a_counter_is_missing() {
        let bare: StatsSample = serde_json::from_value(json!({
            "cpu_stats": { "cpu_usage": {} },
            "memory_stats": {},
            "blkio_stats": { "io_service_bytes_recursive": null },
        }))
        .expect("a sample");

        assert_eq!(
            ContainerMetrics::new(&bare, Some(&bare)),
            ContainerMetrics::default()
        );
    }
}
