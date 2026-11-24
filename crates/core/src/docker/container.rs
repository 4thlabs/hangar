//! The containers of the compose projects, as the daemon lists and inspects them.

use std::collections::HashMap;

use futures::future;

use super::engine::{ContainerInspection, ContainerSummary, Containers as _, EngineMessage, Port};
use super::{ComposeContainers, Docker, DockerError};

/// The label compose puts on each container of a project, set to the project's name.
pub(crate) const PROJECT_LABEL: &str = "com.docker.compose.project";

/// The label compose puts on each container of a service, set to the service's name.
const SERVICE_LABEL: &str = "com.docker.compose.service";

/// The label compose puts on each replica of a service, set to its index from 1.
const CONTAINER_NUMBER_LABEL: &str = "com.docker.compose.container-number";

/// The label compose sets to `True` on the container of a `docker compose run`, which is not part of its service.
const ONEOFF_LABEL: &str = "com.docker.compose.oneoff";

/// The shortest prefix of a container id that a caller may name a container by, as `docker ps` shortens it.
const SHORTEST_ID: usize = 12;

/// The length of a full container id.
const FULL_ID: usize = 64;

/// A container of a compose service, as the project's page shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposeContainer {
    /// The full container id.
    pub id: String,
    /// The container's name, without the leading `/` the daemon gives it.
    pub name: String,
    /// The compose project it belongs to.
    pub project: String,
    /// The compose service it is a replica of.
    pub service: String,
    /// Its index among the replicas of its service, from 1, when compose gave it a readable one.
    pub replica: Option<u32>,
    /// The image as compose runs it, such as `nginx:alpine`.
    pub image: String,
    /// What it is doing.
    pub state: ContainerState,
    /// What its healthcheck says, when it declares one.
    pub health: Option<Health>,
    /// How many times the daemon restarted it, when the daemon says.
    pub restart_count: Option<u64>,
    /// The ports it publishes on the host, by host port.
    pub ports: Vec<PublishedPort>,
}

/// What a container is doing, as the daemon reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Health {
    /// Not checked yet, within the start period.
    Starting,
    /// The last checks passed.
    Healthy,
    /// The last checks failed.
    Unhealthy,
}

/// A port that a container publishes on the host.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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

impl ComposeContainer {
    /// The container that a list entry and its inspection describe, when it is a replica of a compose service: not
    /// a container compose did not make, nor the one of a `docker compose run`.
    pub(crate) fn from_daemon(
        summary: ContainerSummary,
        inspection: ContainerInspection,
    ) -> Option<Self> {
        let mut labels = summary.labels;

        if Self::is_oneoff(&labels) {
            return None;
        }

        let project = labels
            .remove(PROJECT_LABEL)
            .filter(|name| !name.is_empty())?;
        let service = labels
            .remove(SERVICE_LABEL)
            .filter(|name| !name.is_empty())?;
        let name = summary
            .names
            .first()
            .map(|name| name.trim_start_matches('/').to_owned())
            .unwrap_or_default();

        Some(Self {
            id: summary.id,
            name,
            project,
            service,
            replica: labels
                .get(CONTAINER_NUMBER_LABEL)
                .and_then(|number| number.parse().ok()),
            image: summary.image,
            state: ContainerState::from_daemon(&summary.state),
            health: inspection
                .state
                .health
                .and_then(|health| Health::from_daemon(&health.status)),
            restart_count: inspection.restart_count,
            ports: PublishedPort::from_daemon(summary.ports),
        })
    }

    /// Whether compose made the container for a `docker compose run`.
    fn is_oneoff(labels: &HashMap<String, String>) -> bool {
        labels
            .get(ONEOFF_LABEL)
            .is_some_and(|oneoff| oneoff.eq_ignore_ascii_case("true"))
    }

    /// Whether `id` can name a container: at least the 12 first hexadecimal digits of its id. A name cannot, so that
    /// a caller only reaches a container through the project it lists it in.
    fn is_id(id: &str) -> bool {
        (SHORTEST_ID..=FULL_ID).contains(&id.len())
            && id.bytes().all(|byte| byte.is_ascii_hexdigit())
    }
}

impl ContainerState {
    /// The state the daemon lists.
    fn from_daemon(state: &str) -> Self {
        match state {
            "created" => Self::Created,
            "running" => Self::Running,
            "paused" => Self::Paused,
            "restarting" => Self::Restarting,
            "exited" => Self::Exited,
            "removing" => Self::Removing,
            "dead" => Self::Dead,
            _ => Self::Unknown,
        }
    }
}

impl Health {
    /// What a healthcheck's status says; nothing for `none`, which the daemon gives a container that declares none.
    fn from_daemon(status: &str) -> Option<Self> {
        match status {
            "starting" => Some(Self::Starting),
            "healthy" => Some(Self::Healthy),
            "unhealthy" => Some(Self::Unhealthy),
            _ => None,
        }
    }
}

impl PublishedPort {
    /// The ports of a list entry that are published on the host, by host port.
    fn from_daemon(ports: Vec<Port>) -> Vec<Self> {
        let mut published: Vec<Self> = ports
            .into_iter()
            .filter_map(|port| {
                Some(Self {
                    public_port: port.public_port.filter(|public| *public != 0)?,
                    private_port: port.private_port,
                    protocol: port.protocol,
                    ip: port.ip,
                })
            })
            .collect();

        published.sort_by_key(|port| port.public_port);

        published
    }
}

impl Docker {
    /// The containers of every compose project on the host, in any state. Those of a `docker compose run` are left
    /// out, as is a container removed while they were read.
    ///
    /// # Errors
    ///
    /// When the daemon cannot list its containers, or inspect one that it listed and that still exists.
    pub async fn containers(&self) -> Result<ComposeContainers, DockerError> {
        let summaries = self.list_containers(true, PROJECT_LABEL.to_owned()).await?;
        let inspections = future::join_all(summaries.into_iter().map(|summary| async {
            let inspection = self.engine.containers().inspect(&summary.id).await;

            (summary, inspection)
        }))
        .await;

        Self::gather(inspections)
    }

    /// The compose containers that the inspections of the listed containers describe. A container removed since the
    /// list answers 404 and is left out, as `docker ps` does; any other failure fails the whole read, so that a
    /// daemon going away between the list and the inspections does not read as every app stopped.
    fn gather(
        inspections: Vec<(
            ContainerSummary,
            quoll::Result<ContainerInspection, EngineMessage>,
        )>,
    ) -> Result<ComposeContainers, DockerError> {
        let mut containers = Vec::new();

        for (summary, inspection) in inspections {
            match inspection {
                Ok(inspection) => {
                    containers.extend(ComposeContainer::from_daemon(summary, inspection))
                }
                Err(error) if DockerError::is_gone(&error) => {}
                Err(error) => return Err(DockerError::daemon("inspect a container", error)),
            }
        }

        Ok(ComposeContainers::new(containers))
    }

    /// The container of `project` whose id starts with `container_id`. Looked up within the project, so that an id
    /// of another project reads as missing.
    ///
    /// # Errors
    ///
    /// [`DockerError::NotFound`] when `container_id` is not 12 to 64 hexadecimal digits, in either case, or names no container of a
    /// service of `project`; [`DockerError::Daemon`] when the daemon cannot list or inspect it.
    pub async fn project_container(
        &self,
        project: &str,
        container_id: &str,
    ) -> Result<ComposeContainer, DockerError> {
        let missing = || DockerError::not_found(format!("container {container_id}"));

        if !ComposeContainer::is_id(container_id) {
            return Err(missing());
        }

        // Docker writes its ids in lowercase.
        let prefix = container_id.to_ascii_lowercase();

        let summary = self
            .list_containers(true, format!("{PROJECT_LABEL}={project}"))
            .await?
            .into_iter()
            .find(|summary| summary.id.starts_with(&prefix))
            .ok_or_else(missing)?;
        let inspection = self
            .engine
            .containers()
            .inspect(&summary.id)
            .await
            .map_err(|error| {
                if DockerError::is_gone(&error) {
                    missing()
                } else {
                    DockerError::daemon("inspect a container", error)
                }
            })?;

        ComposeContainer::from_daemon(summary, inspection).ok_or_else(missing)
    }

    /// The containers carrying `label`, a name or a `name=value`: all of them, or the running ones alone.
    pub(crate) async fn list_containers(
        &self,
        all: bool,
        label: String,
    ) -> Result<Vec<ContainerSummary>, DockerError> {
        let filters = HashMap::from([("label", [label])]);
        let filters = serde_json::to_string(&filters).expect("a map of strings is JSON");

        self.engine
            .containers()
            .list(all, &filters)
            .await
            .map_err(|error| DockerError::daemon("list the containers", error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The JSON of a list entry for a running replica `alpha-web-1` of the service `web` of `alpha`, with `labels`
    /// on top.
    fn summary(labels: &[(&str, &str)]) -> ContainerSummary {
        let mut all = serde_json::json!({
            (PROJECT_LABEL): "alpha",
            (SERVICE_LABEL): "web",
            (CONTAINER_NUMBER_LABEL): "1",
        });

        for (name, value) in labels {
            all[*name] = (*value).into();
        }

        serde_json::from_value(serde_json::json!({
            "Id": "a".repeat(FULL_ID),
            "Names": ["/alpha-web-1"],
            "Image": "nginx:alpine",
            "State": "running",
            "Status": "Up 2 minutes",
            "Labels": all,
            "Ports": [
                { "IP": "0.0.0.0", "PrivatePort": 443, "PublicPort": 8443, "Type": "tcp" },
                { "PrivatePort": 9000, "Type": "tcp" },
                { "IP": "0.0.0.0", "PrivatePort": 80, "PublicPort": 8080, "Type": "tcp" },
            ],
        }))
        .expect("a list entry")
    }

    /// The JSON of an inspection, with a healthcheck that says `health` when there is one.
    fn inspection(health: Option<&str>) -> ContainerInspection {
        let state = match health {
            Some(status) => {
                serde_json::json!({ "Status": "running", "Health": { "Status": status } })
            }
            None => serde_json::json!({ "Status": "running" }),
        };

        serde_json::from_value(serde_json::json!({ "RestartCount": 2, "State": state }))
            .expect("an inspection")
    }

    #[test]
    fn reads_a_replica_of_a_compose_service() {
        let container = ComposeContainer::from_daemon(summary(&[]), inspection(None));
        let port = |private_port, public_port| PublishedPort {
            ip: Some("0.0.0.0".to_owned()),
            private_port,
            public_port,
            protocol: "tcp".to_owned(),
        };

        assert_eq!(
            container,
            Some(ComposeContainer {
                id: "a".repeat(FULL_ID),
                name: "alpha-web-1".to_owned(),
                project: "alpha".to_owned(),
                service: "web".to_owned(),
                replica: Some(1),
                image: "nginx:alpine".to_owned(),
                state: ContainerState::Running,
                health: None,
                restart_count: Some(2),
                // Only the published ones, by host port.
                ports: vec![port(80, 8080), port(443, 8443)],
            })
        );
    }

    #[test]
    fn leaves_out_a_container_compose_did_not_make_for_a_service() {
        let mut without_service = summary(&[]);

        without_service.labels.remove(SERVICE_LABEL);

        assert_eq!(
            ComposeContainer::from_daemon(without_service, inspection(None)),
            None
        );
        assert_eq!(
            ComposeContainer::from_daemon(summary(&[(PROJECT_LABEL, "")]), inspection(None)),
            None
        );
    }

    #[test]
    fn leaves_out_the_container_of_a_compose_run() {
        let oneoff = summary(&[(ONEOFF_LABEL, "True")]);

        assert_eq!(
            ComposeContainer::from_daemon(oneoff, inspection(None)),
            None
        );
    }

    #[test]
    fn reads_no_replica_from_an_unreadable_container_number() {
        let container = ComposeContainer::from_daemon(
            summary(&[(CONTAINER_NUMBER_LABEL, "x")]),
            inspection(None),
        );

        assert_eq!(container.and_then(|container| container.replica), None);
    }

    #[test]
    fn reads_the_healthcheck_and_none_without_one() {
        let health = |status| {
            ComposeContainer::from_daemon(summary(&[]), inspection(status))
                .and_then(|container| container.health)
        };

        assert_eq!(health(Some("healthy")), Some(Health::Healthy));
        assert_eq!(health(Some("unhealthy")), Some(Health::Unhealthy));
        assert_eq!(health(Some("starting")), Some(Health::Starting));
        assert_eq!(health(Some("none")), None);
        assert_eq!(health(None), None);
    }

    #[test]
    fn reads_a_state_newer_than_hangar_as_unknown() {
        assert_eq!(
            ContainerState::from_daemon("exited"),
            ContainerState::Exited
        );
        assert_eq!(
            ContainerState::from_daemon("hibernating"),
            ContainerState::Unknown
        );
    }

    #[test]
    fn leaves_out_a_container_removed_since_the_list() {
        let gone = quoll::Error::not_found("No such container").into_shape();

        let containers = Docker::gather(vec![(summary(&[]), Err(gone))]).expect("the containers");

        assert!(containers.as_slice().is_empty());
    }

    #[test]
    fn fails_the_read_when_an_inspection_fails_otherwise() {
        let down = quoll::Error::internal("the daemon went away").into_shape();
        let inspections = vec![
            (summary(&[]), Ok(inspection(None))),
            (summary(&[]), Err(down)),
        ];

        let error = Docker::gather(inspections).expect_err("a failed read");

        assert!(matches!(error, DockerError::Daemon { .. }), "{error:?}");
    }

    #[test]
    fn names_a_container_only_by_twelve_to_sixty_four_hexadecimal_digits() {
        assert!(ComposeContainer::is_id("0123456789ab"));
        assert!(ComposeContainer::is_id(&"f".repeat(FULL_ID)));
        assert!(!ComposeContainer::is_id("0123456789a"));
        assert!(!ComposeContainer::is_id(&"f".repeat(FULL_ID + 1)));
        assert!(!ComposeContainer::is_id("alpha-web-1"));
    }
}
