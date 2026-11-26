//! The containers of the compose projects, as the daemon lists and inspects them.

use std::collections::HashMap;

use futures::{StreamExt, stream};

use super::engine::{ContainerInspection, ContainerSummary, Containers as _, EngineMessage, Port};
use super::{CONCURRENT_CALLS, ComposeContainers, Docker, DockerError};

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

/// A container of a compose service, as the project's page shows it. The core builds it, from what the daemon lists
/// and inspects: it also keeps the health its list entry shows, which [`ComposeContainer::health`] reads, and which
/// two containers must share to be equal.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
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
    /// The id of the image it was created from, `sha256:...`: a pull moves the reference, not the image a container
    /// runs until it is recreated.
    pub image_id: String,
    /// What it is doing.
    pub state: ContainerState,
    /// What its inspection adds to its list entry; none when it was not inspected, as by
    /// [`Docker::project_container`], or its inspection failed. Its restarts are then unknown: read its health with
    /// [`ComposeContainer::health`], which falls back on its list entry.
    pub details: Option<ContainerDetails>,
    /// What the status of its list entry shows of its healthcheck, as `docker ps` does. Docker shows it only for a
    /// container that runs and is not paused: none otherwise, as for one that declares no healthcheck.
    pub(crate) listed_health: Option<Health>,
    /// The ports it publishes on the host, by host port.
    pub ports: Vec<PublishedPort>,
}

/// What the inspection of a container adds to its list entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ContainerDetails {
    /// What its healthcheck says; none when it declares no healthcheck.
    pub health: Option<Health>,
    /// How many times the daemon restarted it, when the daemon says.
    pub restart_count: Option<u64>,
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
    /// a container compose did not make, nor the one of a `docker compose run`. Without its inspection, which
    /// failed, its details are unknown.
    pub(crate) fn from_daemon(
        summary: ContainerSummary,
        inspection: Option<ContainerInspection>,
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
            image_id: summary.image_id,
            state: ContainerState::from_daemon(&summary.state),
            details: inspection.map(ContainerDetails::from_daemon),
            listed_health: Health::from_status(&summary.status),
            ports: PublishedPort::from_daemon(summary.ports),
        })
    }

    /// What its healthcheck says: from its inspection, else from the status of its list entry.
    pub fn health(&self) -> Option<Health> {
        match self.details {
            Some(details) => details.health,
            None => self.listed_health,
        }
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

impl ContainerDetails {
    /// What an inspection says.
    fn from_daemon(inspection: ContainerInspection) -> Self {
        Self {
            health: inspection
                .state
                .health
                .and_then(|health| Health::from_daemon(&health.status)),
            restart_count: inspection.restart_count,
        }
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

impl Health {
    /// What the status of a list entry shows of the healthcheck, at its end, as `Up 5 minutes (unhealthy)`.
    fn from_status(status: &str) -> Option<Self> {
        let shown = status.trim_end().strip_suffix(')')?.rsplit_once('(')?.1;

        match shown {
            "health: starting" => Some(Self::Starting),
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
    /// out, as is a container removed while they were read; one whose inspection failed otherwise is kept with no
    /// details.
    ///
    /// # Errors
    ///
    /// When the daemon cannot list its containers. The inspections that follow fail no read.
    pub async fn containers(&self) -> Result<ComposeContainers, DockerError> {
        let summaries = self.list_containers(true, PROJECT_LABEL.to_owned()).await?;
        let inspections = stream::iter(summaries)
            .map(|summary| async {
                let inspection = self.engine.containers().inspect(&summary.id).await;

                (summary, inspection)
            })
            .buffered(CONCURRENT_CALLS)
            .collect()
            .await;

        Ok(Self::gather(inspections))
    }

    /// The compose containers that the listed containers and their inspections describe. The list is the truth:
    ///
    /// - A container whose inspection answers 404 with Docker's `No such container: …`, or Podman's
    ///   `…: no such container`, is left out: it went away since the list, as `docker ps` leaves it out.
    /// - A container whose inspection failed otherwise, with a 500, another 404, a deadline passed, a refused
    ///   connection or an answer that does not read, is kept as its list entry gives it, with no details. Each
    ///   failure is logged at debug, under one warning per read that says how many containers it kept so, and the
    ///   first error.
    /// - The container of a `docker compose run`, or one without the labels of a service, is left out, whatever its
    ///   inspection gave.
    fn gather(
        inspections: Vec<(
            ContainerSummary,
            quoll::Result<ContainerInspection, EngineMessage>,
        )>,
    ) -> ComposeContainers {
        let mut failed = 0;
        let mut first_failure = None;
        let mut containers = Vec::new();

        for (summary, inspection) in inspections {
            let (inspection, failure) = match inspection {
                Ok(inspection) => (Some(inspection), None),
                Err(error) if DockerError::is_gone(&error) => continue,
                Err(error) => {
                    tracing::debug!(container = %summary.id, %error, "could not inspect a container");

                    (None, Some(error))
                }
            };
            let Some(container) = ComposeContainer::from_daemon(summary, inspection) else {
                continue;
            };

            if let Some(error) = failure {
                failed += 1;
                first_failure.get_or_insert(error);
            }

            containers.push(container);
        }

        if let Some(error) = first_failure {
            tracing::warn!(
                failed,
                %error,
                "could not inspect every container: each that failed is kept with no details"
            );
        }

        ComposeContainers::new(containers)
    }

    /// The container of `project` whose id starts with `container_id`, as the list gives it, with no details: a
    /// caller that needs them reads [`Docker::containers`]. Looked up within the project, so that an id of another
    /// project reads as missing.
    ///
    /// # Errors
    ///
    /// [`DockerError::NotFound`] when `container_id` is not 12 to 64 hexadecimal digits, in either case, or names no
    /// container of a service of `project`; [`DockerError::Daemon`] when the daemon cannot list its containers.
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

        ComposeContainer::from_daemon(summary, None).ok_or_else(missing)
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
    use std::time::Duration;

    use quoll::Call as _;
    use tokio::net::{TcpListener, TcpSocket};

    use super::super::host::Host;
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
            "ImageID": "sha256:alpine",
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

    /// The container that [`summary`] lists, written out, with `details`.
    fn alpha_web(details: Option<ContainerDetails>) -> ComposeContainer {
        let port = |private_port, public_port| PublishedPort {
            ip: Some("0.0.0.0".to_owned()),
            private_port,
            public_port,
            protocol: "tcp".to_owned(),
        };

        ComposeContainer {
            id: "a".repeat(FULL_ID),
            name: "alpha-web-1".to_owned(),
            project: "alpha".to_owned(),
            service: "web".to_owned(),
            replica: Some(1),
            image: "nginx:alpine".to_owned(),
            image_id: "sha256:alpine".to_owned(),
            state: ContainerState::Running,
            details,
            listed_health: None,
            // Only the published ones, by host port.
            ports: vec![port(80, 8080), port(443, 8443)],
        }
    }

    #[test]
    fn reads_a_replica_of_a_compose_service() {
        let container = ComposeContainer::from_daemon(summary(&[]), Some(inspection(None)));
        let details = ContainerDetails {
            health: None,
            restart_count: Some(2),
        };

        assert_eq!(container, Some(alpha_web(Some(details))));
    }

    #[test]
    fn reads_the_healthcheck_the_status_of_a_list_entry_shows() {
        assert_eq!(
            Health::from_status("Up 5 minutes (unhealthy)"),
            Some(Health::Unhealthy)
        );
        assert_eq!(
            Health::from_status("Up 5 seconds (health: starting)"),
            Some(Health::Starting)
        );
        assert_eq!(
            Health::from_status("Up 2 hours (healthy)"),
            Some(Health::Healthy)
        );
        assert_eq!(Health::from_status("Up 2 hours"), None);
        assert_eq!(Health::from_status("Exited (1) 2 minutes ago"), None);
    }

    #[test]
    fn reads_the_health_from_the_list_entry_when_the_inspection_failed() {
        let mut unhealthy = summary(&[]);

        unhealthy.status = "Up 5 minutes (unhealthy)".to_owned();

        let inspected =
            ComposeContainer::from_daemon(unhealthy.clone(), Some(inspection(Some("healthy"))))
                .expect("a container");
        let listed = ComposeContainer::from_daemon(unhealthy, None).expect("a container");

        // The inspection, when there is one, says more than the list.
        assert_eq!(inspected.health(), Some(Health::Healthy));
        assert_eq!(listed.health(), Some(Health::Unhealthy));
    }

    #[test]
    fn leaves_out_a_container_compose_did_not_make_for_a_service() {
        let mut without_service = summary(&[]);

        without_service.labels.remove(SERVICE_LABEL);

        assert_eq!(
            ComposeContainer::from_daemon(without_service, Some(inspection(None))),
            None
        );
        assert_eq!(
            ComposeContainer::from_daemon(summary(&[(PROJECT_LABEL, "")]), Some(inspection(None))),
            None
        );
    }

    #[test]
    fn leaves_out_the_container_of_a_compose_run() {
        let oneoff = summary(&[(ONEOFF_LABEL, "True")]);

        assert_eq!(
            ComposeContainer::from_daemon(oneoff, Some(inspection(None))),
            None
        );
    }

    #[test]
    fn reads_no_replica_from_an_unreadable_container_number() {
        let container = ComposeContainer::from_daemon(
            summary(&[(CONTAINER_NUMBER_LABEL, "x")]),
            Some(inspection(None)),
        );

        assert_eq!(container.and_then(|container| container.replica), None);
    }

    #[test]
    fn reads_the_healthcheck_and_none_without_one() {
        let health = |status| {
            ComposeContainer::from_daemon(summary(&[]), Some(inspection(status)))
                .and_then(|container| container.details?.health)
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

    /// Aborts its task when dropped, as when the test fails before it would.
    struct Aborting(tokio::task::JoinHandle<()>);

    impl Drop for Aborting {
        fn drop(&mut self) {
            self.0.abort();
        }
    }

    /// An inspection's error with `status`, as the daemon answers it.
    fn answered(status: u16, message: &str) -> quoll::Error<EngineMessage> {
        let status = http::StatusCode::from_u16(status).expect("a status");
        let message = EngineMessage {
            message: message.to_owned(),
        };

        quoll::Error::answered(status, message)
    }

    /// The error of an inspection sent to `port` of this host, within `deadline`.
    async fn inspection_error(port: u16, deadline: Duration) -> quoll::Error<EngineMessage> {
        let engine = Host::Tcp(format!("http://127.0.0.1:{port}"))
            .client()
            .expect("a client");

        engine
            .containers()
            .inspect("abc")
            .timeout(deadline)
            .await
            .expect_err("a failed inspection")
    }

    /// The containers of `summary` with its inspection failed by `error`, and of a running one-off beside it.
    fn gathered_with_failed(error: quoll::Error<EngineMessage>) -> Vec<ComposeContainer> {
        let oneoff = summary(&[(ONEOFF_LABEL, "True")]);
        let inspections = vec![(summary(&[]), Err(error)), (oneoff, Ok(inspection(None)))];

        Docker::gather(inspections).as_slice().to_vec()
    }

    /// Asserts that `containers` is the container of [`summary`] alone, as its list entry gives it.
    fn assert_kept_from_its_summary(containers: &[ComposeContainer]) {
        assert_eq!(containers, [alpha_web(None)]);
    }

    #[test]
    fn leaves_out_a_container_removed_since_the_list() {
        let gone = answered(404, &format!("No such container: {}", "a".repeat(FULL_ID)));

        assert!(gathered_with_failed(gone).is_empty());
    }

    #[test]
    fn leaves_out_a_container_podman_says_is_gone() {
        let gone = answered(
            404,
            "no container with name or ID \"abc\" found: no such container",
        );

        assert!(gathered_with_failed(gone).is_empty());
    }

    #[test]
    fn keeps_a_container_whose_inspection_answered_a_404_that_is_not_dockers() {
        // A socket proxy that lets the list through, and not the inspections.
        assert_kept_from_its_summary(&gathered_with_failed(answered(404, "404 page not found")));
    }

    #[test]
    fn keeps_a_container_whose_inspection_answered_500_from_its_summary() {
        let failed = answered(500, "error during connect");

        assert_kept_from_its_summary(&gathered_with_failed(failed));
    }

    #[tokio::test]
    async fn keeps_a_container_whose_inspection_passed_its_deadline_from_its_summary() {
        // A server that takes each connection and never answers.
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("a listener");
        let port = listener.local_addr().expect("its address").port();
        let _silent = Aborting(tokio::spawn(async move {
            let mut held = Vec::new();

            while let Ok((connection, _)) = listener.accept().await {
                held.push(connection);
            }
        }));

        let error = inspection_error(port, Duration::from_millis(200)).await;

        assert_kept_from_its_summary(&gathered_with_failed(error));
    }

    #[tokio::test]
    async fn keeps_a_container_whose_inspection_was_refused_from_its_summary() {
        // A socket bound but not listening: it holds its port, and refuses each connection.
        let socket = TcpSocket::new_v4().expect("a socket");

        socket
            .bind("127.0.0.1:0".parse().expect("an address"))
            .expect("a bound socket");

        let port = socket.local_addr().expect("its address").port();
        let error = inspection_error(port, Duration::from_secs(5)).await;

        assert_kept_from_its_summary(&gathered_with_failed(error));
    }

    #[tokio::test]
    async fn fails_the_read_when_the_list_fails() {
        let socket = TcpSocket::new_v4().expect("a socket");

        socket
            .bind("127.0.0.1:0".parse().expect("an address"))
            .expect("a bound socket");

        let port = socket.local_addr().expect("its address").port();
        let docker = Docker {
            engine: Host::Tcp(format!("http://127.0.0.1:{port}"))
                .client()
                .expect("a client"),
        };

        let error = docker.containers().await.expect_err("a failed read");

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
