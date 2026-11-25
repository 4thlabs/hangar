//! The daemon's events, read as what they make stale, followed again when the daemon restarts.

use futures::{Stream, StreamExt, stream};
use quoll::client::{self, Followed};

use super::container::PROJECT_LABEL;
use super::engine::{EngineMessage, Event, System};
use super::{Docker, DockerError};

/// The label the daemon puts on the container of a Swarm task.
const SWARM_TASK_LABEL: &str = "com.docker.swarm.task.id";

/// The kinds of things whose events are followed.
const KINDS: [&str; 5] = ["container", "image", "volume", "node", "service"];

/// The actions followed: only those that change a read, which leaves out the noisy ones. A healthcheck runs as an exec
/// every interval, and `exec_*`, `attach` or `top` change nothing that is read. The daemon matches `health_status` by
/// prefix, so it covers `health_status: healthy`.
const ACTIONS: [&str; 20] = [
    // Containers
    "create",
    "start",
    "restart",
    "stop",
    "die",
    "kill",
    "pause",
    "unpause",
    "destroy",
    "rename",
    "update",
    "health_status",
    // Images
    "pull",
    "tag",
    "untag",
    "delete",
    "import",
    "load",
    // Containers, images and volumes
    "prune",
    // Nodes and services; `create` and `update` are listed with the containers
    "remove",
];

/// What an event of the daemon may have made stale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DockerChange {
    /// The containers of the compose projects.
    Containers,
    /// The images on the host.
    Images,
    /// The usage of the whole host: its containers, images and volumes.
    Overview,
    /// The nodes, services and tasks of the swarm.
    Swarm,
}

impl DockerChange {
    /// Every change, which a new connection reports: what happened while nothing followed went by unseen.
    pub const ALL: [Self; 4] = [Self::Containers, Self::Images, Self::Overview, Self::Swarm];

    /// What `event` made stale.
    ///
    /// Any container counts for the overview, which reports the whole host; only a compose one counts for the
    /// containers, which hold no other. The container of a Swarm task counts for the swarm: Docker sends no event for
    /// the task itself, so it is the only sign of one on this node.
    fn of(event: &Event) -> &'static [Self] {
        let attributes = &event.actor.attributes;

        match event.kind.as_str() {
            "container" if attributes.contains_key(PROJECT_LABEL) => {
                &[Self::Containers, Self::Overview]
            }
            "container" if attributes.contains_key(SWARM_TASK_LABEL) => {
                &[Self::Swarm, Self::Overview]
            }
            "container" | "volume" => &[Self::Overview],
            "image" => &[Self::Images, Self::Overview],
            "node" | "service" => &[Self::Swarm],
            _ => &[],
        }
    }

    /// What a state of the followed events makes stale, or the error that ends them, logged here once.
    fn after(followed: Followed<Event, EngineMessage>) -> Vec<Result<Self, DockerError>> {
        match followed {
            Followed::Connected => {
                tracing::info!("following the Docker daemon's events");

                Self::ALL.into_iter().map(Ok).collect()
            }
            Followed::Item(event) => Self::of(&event).iter().copied().map(Ok).collect(),
            // An event that does not read made stale what it made stale, which is not known: everything.
            Followed::Skipped(error) => {
                tracing::warn!(%error, "could not read a Docker event");

                Self::ALL.into_iter().map(Ok).collect()
            }
            // Nothing is stale yet: the next connection reports everything.
            Followed::Reconnecting {
                error: Some(error),
                wait,
            } => {
                tracing::warn!(%error, ?wait, "the Docker events failed, following them again");

                Vec::new()
            }
            Followed::Reconnecting { error: None, wait } => {
                tracing::warn!(?wait, "the Docker events ended, following them again");

                Vec::new()
            }
            Followed::Stopped(error) => {
                tracing::error!(%error, "the Docker daemon refused the events, no longer following them");

                vec![Err(DockerError::daemon("follow the Docker events", error))]
            }
        }
    }

    /// The JSON of the filters of `GET /events`: the kinds and the actions followed.
    fn filters() -> String {
        let filters = serde_json::json!({ "type": KINDS, "event": ACTIONS });

        filters.to_string()
    }
}

impl Docker {
    /// What the daemon's events make stale, as they happen, whoever caused them: [`DockerChange::ALL`] first, then
    /// what each event changes, and everything for an event that does not read. When the daemon goes away, it follows
    /// them again, after a wait that doubles up to 30 seconds, and reports every change once it is back; the wait
    /// starts again from a second once a connection has stayed open for 10 seconds. Dropping it stops following.
    ///
    /// The changes come one per event: a caller that reloads a read on each batches them first.
    ///
    /// # Errors
    ///
    /// It ends with a [`DockerError::Daemon`] when the daemon refuses the call in a way that calling again would not
    /// change, a 4xx such as an API version it does not serve: the error is logged once, and nothing is followed
    /// after it. It never ends otherwise.
    pub fn events(&self) -> impl Stream<Item = Result<DockerChange, DockerError>> + Send + 'static {
        Self::follow(self.engine.system())
    }

    /// The changes of the events that `system` sends.
    fn follow<S>(
        system: S,
    ) -> impl Stream<Item = Result<DockerChange, DockerError>> + Send + 'static
    where
        S: System + Send + Sync + 'static,
    {
        let filters = DockerChange::filters();

        // The call returns once the daemon answered: from then on, no event goes by unseen.
        client::follow(async move || system.events(&filters).await)
            .flat_map(|followed| stream::iter(DockerChange::after(followed)))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, VecDeque};
    use std::sync::Mutex;
    use std::time::Duration;

    use futures::future;
    use http::StatusCode;
    use quoll::{Call, Error, ErrorKind, JsonLines};
    use serde_json::json;

    use super::super::engine::Actor;
    use super::*;

    /// What a connection of the fake daemon does.
    enum Connection {
        /// The call fails with this error.
        Fails(Error<EngineMessage>),
        /// The daemon sends these events, or errors in their place, then ends the stream.
        Sends(Vec<quoll::Result<Event>>),
    }

    /// A daemon that answers each call as the test says, then never again.
    struct FakeDaemon {
        connections: Mutex<VecDeque<Connection>>,
        filters: Mutex<Vec<String>>,
    }

    impl FakeDaemon {
        fn new(connections: impl IntoIterator<Item = Connection>) -> &'static Self {
            Box::leak(Box::new(Self {
                connections: Mutex::new(connections.into_iter().collect()),
                filters: Mutex::new(Vec::new()),
            }))
        }

        fn calls(&self) -> usize {
            self.filters
                .lock()
                .expect("no test panics with the lock")
                .len()
        }
    }

    impl System for &'static FakeDaemon {
        fn events(&self, filters: &str) -> impl Call<JsonLines<Event>, EngineMessage> {
            self.filters
                .lock()
                .expect("no test panics with the lock")
                .push(filters.to_owned());

            let connection = self
                .connections
                .lock()
                .expect("no test panics with the lock")
                .pop_front();

            async move {
                match connection {
                    Some(Connection::Sends(events)) => Ok(JsonLines::try_new(stream::iter(events))),
                    Some(Connection::Fails(error)) => Err(error),
                    None => future::pending().await,
                }
            }
        }
    }

    fn event(kind: &str, attributes: &[(&str, &str)]) -> Event {
        Event {
            kind: kind.to_owned(),
            actor: Actor {
                attributes: attributes
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect::<HashMap<_, _>>(),
            },
        }
    }

    fn compose_container() -> Event {
        event(
            "container",
            &[(PROJECT_LABEL, "alpha"), ("name", "alpha-web-1")],
        )
    }

    /// Every change that `daemon` makes the stream give, until none comes for an hour.
    async fn all_changes(daemon: &'static FakeDaemon) -> Vec<DockerChange> {
        let mut changes = Box::pin(Docker::follow(daemon));
        let mut read = Vec::new();

        while let Ok(Some(change)) =
            tokio::time::timeout(Duration::from_secs(3600), changes.next()).await
        {
            read.push(change.expect("a change, not an error"));
        }

        read
    }

    #[test]
    fn makes_the_containers_stale_for_a_compose_container_and_the_overview_for_any() {
        assert_eq!(
            DockerChange::of(&compose_container()),
            [DockerChange::Containers, DockerChange::Overview]
        );
        assert_eq!(
            DockerChange::of(&event("container", &[])),
            [DockerChange::Overview]
        );
    }

    #[test]
    fn makes_the_images_stale_for_an_image_and_the_overview_for_an_image_or_a_volume() {
        assert_eq!(
            DockerChange::of(&event("image", &[])),
            [DockerChange::Images, DockerChange::Overview]
        );
        assert_eq!(
            DockerChange::of(&event("volume", &[])),
            [DockerChange::Overview]
        );
    }

    #[test]
    fn makes_the_swarm_stale_for_a_node_a_service_or_the_container_of_a_task() {
        assert_eq!(DockerChange::of(&event("node", &[])), [DockerChange::Swarm]);
        assert_eq!(
            DockerChange::of(&event("service", &[])),
            [DockerChange::Swarm]
        );
        assert_eq!(
            DockerChange::of(&event("container", &[(SWARM_TASK_LABEL, "t1")])),
            [DockerChange::Swarm, DockerChange::Overview]
        );
        assert!(DockerChange::of(&event("network", &[])).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn reports_every_change_once_connected_then_those_of_each_event() {
        let daemon = FakeDaemon::new([
            Connection::Sends(vec![Ok(event("image", &[]))]),
            Connection::Sends(Vec::new()),
        ]);

        let changes = all_changes(daemon).await;

        assert_eq!(
            changes,
            [
                DockerChange::ALL.as_slice(),
                &[DockerChange::Images, DockerChange::Overview],
                // The stream ended: the next connection reports everything again.
                DockerChange::ALL.as_slice(),
            ]
            .concat()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn asks_the_daemon_only_for_the_actions_that_change_a_read() {
        let daemon = FakeDaemon::new([Connection::Sends(Vec::new())]);

        Docker::follow(daemon).next().await;

        let filters = daemon.filters.lock().expect("no test panics with the lock");
        let filters: serde_json::Value = serde_json::from_str(&filters[0]).expect("JSON filters");

        assert_eq!(filters["type"], json!(KINDS));
        assert!(
            filters["event"]
                .as_array()
                .is_some_and(|actions| actions.contains(&json!("die")))
        );
        assert!(
            !filters["event"]
                .as_array()
                .is_some_and(|actions| actions.contains(&json!("exec_start")))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn reports_every_change_for_an_event_it_cannot_read_and_goes_on() {
        let daemon = FakeDaemon::new([Connection::Sends(vec![
            Err(Error::failed(
                ErrorKind::Decode,
                "an event of a kind Hangar does not know",
            )),
            Ok(compose_container()),
        ])]);

        let changes = all_changes(daemon).await;

        assert_eq!(&changes[4..8], DockerChange::ALL);
        assert_eq!(
            &changes[8..10],
            [DockerChange::Containers, DockerChange::Overview]
        );
        assert_eq!(daemon.calls(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn reports_nothing_for_a_connection_lost_as_the_next_one_reports_everything() {
        let daemon = FakeDaemon::new([
            Connection::Fails(Error::failed(ErrorKind::Connect, "the daemon is down")),
            Connection::Sends(vec![Err(Error::failed(
                ErrorKind::Body,
                "the connection was cut",
            ))]),
            Connection::Sends(Vec::new()),
        ]);

        let changes = all_changes(daemon).await;

        assert_eq!(changes, [DockerChange::ALL, DockerChange::ALL].concat());
        assert_eq!(daemon.calls(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn ends_with_an_error_when_the_daemon_refuses_the_call_for_good() {
        let refused = Error::answered(
            StatusCode::BAD_REQUEST,
            EngineMessage {
                message: "client version 1.44 is too old".to_owned(),
            },
        );
        let daemon = FakeDaemon::new([Connection::Fails(refused)]);
        let mut changes = Box::pin(Docker::follow(daemon));

        let error = changes
            .next()
            .await
            .expect("the error")
            .expect_err("an error, not a change");

        assert!(
            matches!(
                error,
                DockerError::Daemon {
                    action: "follow the Docker events",
                    ..
                }
            ),
            "{error:?}"
        );
        assert!(
            std::error::Error::source(&error).is_some_and(|source| source
                .to_string()
                .contains("client version 1.44 is too old")),
            "{error:?}"
        );
        assert!(changes.next().await.is_none());
        assert_eq!(daemon.calls(), 1);
    }
}
