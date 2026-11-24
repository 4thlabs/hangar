//! The contract of the Docker Engine API: the routes Hangar calls, and the fields of their answers it reads.

use std::collections::HashMap;
use std::fmt;

use quoll::{ByteStream, JsonLines};
use serde::{Deserialize, Deserializer};

quoll::api! {
    /// The Docker Engine API, version 1.44, which Docker 25 and later serve: Docker 29 serves no older one.
    #[openapi(none)]
    #[error(EngineMessage)]
    pub(crate) api Engine = "/v1.44";

    pub(crate) group Containers {
        /// `filters` is the JSON of a map from a filter to its values, as `{"label":["com.docker.compose.project"]}`.
        GET "/containers/json?all={all}&filters={filters}"
            => list(all: bool, filters: &str) -> Vec<ContainerSummary>;
        GET "/containers/{id}/json" => inspect(id: &str) -> ContainerInspection;
        /// Multiplexed frames, `application/vnd.docker.multiplexed-stream`, or the bytes as they are for a container
        /// with a TTY, `application/vnd.docker.raw-stream`.
        GET "/containers/{id}/logs?follow={follow}&stdout={stdout}&stderr={stderr}&timestamps={timestamps}&tail={tail}"
            => logs(id: &str, follow: bool, stdout: bool, stderr: bool, timestamps: bool, tail: &str) -> ByteStream;
        /// With `stream` false and `one-shot` true, one sample at once, with no `precpu_stats`.
        GET "/containers/{id}/stats?stream={stream}&one-shot={one_shot}"
            => stats(id: &str, stream: bool, one_shot: bool) -> StatsSample;
    }

    pub(crate) group System {
        /// Sent as `application/jsonl` by Docker 29 and later, as `application/json` before. `filters` is written
        /// as for the containers.
        GET "/events?filters={filters}" => events(filters: &str) -> JsonLines<Event>;
    }
}

/// A field that Docker may send as `null` where it means empty, as the `Attributes` of an event or the `Labels` of
/// a container: read as its default, rather than failing the whole value.
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// The body of Docker's errors, `{"message": "..."}`, which are not RFC 9457 problems.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct EngineMessage {
    pub(crate) message: String,
}

/// Docker's message, which the error of a call says after its status: `another api answered 404: No such container`.
impl fmt::Display for EngineMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// A container as `GET /containers/json` lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct ContainerSummary {
    pub(crate) id: String,
    /// Each with a leading `/`, as Docker writes them.
    #[serde(deserialize_with = "null_as_default")]
    pub(crate) names: Vec<String>,
    pub(crate) image: String,
    /// `running`, `exited`...
    pub(crate) state: String,
    #[serde(deserialize_with = "null_as_default")]
    pub(crate) labels: HashMap<String, String>,
    #[serde(deserialize_with = "null_as_default")]
    pub(crate) ports: Vec<Port>,
}

/// A port of a container, published on the host or only exposed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct Port {
    #[serde(rename = "IP")]
    pub(crate) ip: Option<String>,
    pub(crate) private_port: u16,
    /// Missing for a port the container exposes without publishing it.
    pub(crate) public_port: Option<u16>,
    /// `tcp`, `udp` or `sctp`.
    #[serde(rename = "Type")]
    pub(crate) protocol: String,
}

/// What `GET /containers/{id}/json` adds to the list: the healthcheck and the restarts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct ContainerInspection {
    pub(crate) restart_count: Option<u64>,
    pub(crate) state: InspectedState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct InspectedState {
    /// Missing for a container that declares no healthcheck.
    pub(crate) health: Option<InspectedHealth>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct InspectedHealth {
    /// `starting`, `healthy`, `unhealthy` or `none`.
    pub(crate) status: String,
}

/// A sample of `GET /containers/{id}/stats`: the fields the metrics are computed from. Each may be missing, as on a
/// container that stopped meanwhile, or on Windows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct StatsSample {
    pub(crate) cpu_stats: CpuStats,
    pub(crate) memory_stats: MemoryStats,
    pub(crate) networks: Option<HashMap<String, NetworkStats>>,
    pub(crate) blkio_stats: BlkioStats,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct CpuStats {
    pub(crate) cpu_usage: CpuUsage,
    pub(crate) system_cpu_usage: Option<u64>,
    pub(crate) online_cpus: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct CpuUsage {
    pub(crate) total_usage: Option<u64>,
    /// Only with cgroup v1.
    pub(crate) percpu_usage: Option<Vec<u64>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct MemoryStats {
    pub(crate) usage: Option<u64>,
    pub(crate) limit: Option<u64>,
    /// The cgroup's own counters, `inactive_file` among them.
    #[serde(deserialize_with = "null_as_default")]
    pub(crate) stats: HashMap<String, u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct NetworkStats {
    pub(crate) rx_bytes: u64,
    pub(crate) tx_bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct BlkioStats {
    /// Null with some versions of cgroup v2.
    pub(crate) io_service_bytes_recursive: Option<Vec<BlkioEntry>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct BlkioEntry {
    /// `read` or `write`, spelled `Read` and `Write` by some versions.
    pub(crate) op: String,
    pub(crate) value: u64,
}

/// An event of `GET /events`: the kind of what it happened to, and that thing's attributes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub(crate) struct Event {
    /// `container`, `image`, `volume`...
    #[serde(rename = "Type")]
    pub(crate) kind: String,
    #[serde(rename = "Actor", deserialize_with = "null_as_default")]
    pub(crate) actor: Actor,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub(crate) struct Actor {
    /// The labels of a container, its `name` and its `image`, among others.
    #[serde(deserialize_with = "null_as_default")]
    pub(crate) attributes: HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_event_whose_attributes_are_null_as_one_with_none() {
        let event: Event = serde_json::from_str(
            r#"{"Type":"volume","Action":"prune","Actor":{"ID":"","Attributes":null}}"#,
        )
        .expect("an event");

        assert_eq!(event.kind, "volume");
        assert!(event.actor.attributes.is_empty());
    }

    #[test]
    fn reads_a_container_whose_labels_and_ports_are_null_as_one_with_none() {
        let summary: ContainerSummary =
            serde_json::from_str(r#"{"Id":"abc","Names":null,"Labels":null,"Ports":null}"#)
                .expect("a list entry");

        assert_eq!(summary.id, "abc");
        assert!(summary.labels.is_empty() && summary.ports.is_empty() && summary.names.is_empty());
    }
}
