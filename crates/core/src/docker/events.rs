//! The daemon's events, read as what they make stale, followed again when the daemon restarts.

use std::collections::VecDeque;
use std::time::Duration;

use futures::{Stream, StreamExt, stream};
use quoll::JsonLines;
use tokio::time::Instant;

use super::Docker;
use super::container::PROJECT_LABEL;
use super::engine::{Event, System};

/// The first pause before following again, doubled after each attempt up to [`LONGEST_PAUSE`].
const FIRST_PAUSE: Duration = Duration::from_secs(1);

/// The longest pause between two attempts to follow.
const LONGEST_PAUSE: Duration = Duration::from_secs(30);

/// How long a connection stays open, with no event, before it counts as working: the pause before the next one then
/// starts again from [`FIRST_PAUSE`]. A proxy that answers then closes at once keeps the pause doubling instead, so
/// that it does not make a reload of everything every second.
const STEADY: Duration = Duration::from_secs(10);

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

    /// The JSON of the filters of `GET /events`: the kinds and the actions followed.
    fn filters() -> String {
        let filters = serde_json::json!({ "type": KINDS, "event": ACTIONS });

        filters.to_string()
    }
}

/// Where the following is.
struct Following<S> {
    system: S,
    filters: String,
    /// The events of the connection, while there is one.
    events: Option<JsonLines<Event>>,
    /// The changes read, not given yet.
    ready: VecDeque<DockerChange>,
    /// When the connection opened, while there is one.
    connected_at: Option<Instant>,
    /// The pause before the next attempt.
    pause: Duration,
    is_first_attempt: bool,
}

impl<S: System + Sync> Following<S> {
    /// The next change, following again for as long as it takes.
    async fn next(mut self) -> Option<(DockerChange, Self)> {
        loop {
            if let Some(change) = self.ready.pop_front() {
                return Some((change, self));
            }

            match &mut self.events {
                Some(events) => match events.next().await {
                    Some(Ok(event)) => {
                        // An event says the connection works.
                        self.pause = FIRST_PAUSE;
                        self.ready.extend(DockerChange::of(&event));
                    }
                    // An event that does not read made stale what it made stale, which is not known: everything. When
                    // the connection failed, the stream ends after it.
                    Some(Err(error)) => {
                        tracing::warn!(%error, "could not read a Docker event");
                        self.ready.extend(DockerChange::ALL);
                    }
                    None => self.disconnect(),
                },
                None => self.connect().await,
            }
        }
    }

    /// Drops the connection that ended, to follow the events again.
    fn disconnect(&mut self) {
        tracing::warn!("the Docker events ended, following them again");

        let was_steady = self
            .connected_at
            .take()
            .is_some_and(|connected_at| connected_at.elapsed() >= STEADY);

        if was_steady {
            self.pause = FIRST_PAUSE;
        }

        self.events = None;
    }

    /// Follows the events, after a pause unless it is the first attempt. A new connection reports every change.
    async fn connect(&mut self) {
        if self.is_first_attempt {
            self.is_first_attempt = false;
        } else {
            tokio::time::sleep(self.pause).await;
            self.pause = (self.pause * 2).min(LONGEST_PAUSE);
        }

        // The call returns once the daemon answered: from then on, no event goes by unseen.
        match self.system.events(&self.filters).await {
            Ok(events) => {
                tracing::info!("following the Docker daemon's events");
                self.events = Some(events);
                self.connected_at = Some(Instant::now());
                self.ready.extend(DockerChange::ALL);
            }
            Err(error) => {
                tracing::warn!(%error, "could not follow the Docker events, trying again")
            }
        }
    }
}

impl Docker {
    /// What the daemon's events make stale, as they happen, whoever caused them: [`DockerChange::ALL`] first, then
    /// what each event changes, and everything for an event that does not read. When the daemon goes away, it follows
    /// them again, after a pause that doubles up to 30 seconds, and reports every change once it is back. The pause
    /// starts again from a second once a connection has given an event or stayed open for 10 seconds. It never ends:
    /// dropping it stops following.
    ///
    /// The changes come one per event: a caller that reloads a read on each batches them first.
    pub fn events(&self) -> impl Stream<Item = DockerChange> + Send + 'static {
        Self::follow(self.engine.system())
    }

    /// The changes of the events that `system` sends.
    fn follow<S>(system: S) -> impl Stream<Item = DockerChange> + Send + 'static
    where
        S: System + Send + Sync + 'static,
    {
        let following = Following {
            system,
            filters: DockerChange::filters(),
            events: None,
            ready: VecDeque::new(),
            connected_at: None,
            pause: FIRST_PAUSE,
            is_first_attempt: true,
        };

        stream::unfold(following, Following::next)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use futures::future;
    use quoll::{Call, Error};
    use serde_json::json;

    use super::super::engine::{Actor, EngineMessage};
    use super::*;

    /// What a connection of the fake daemon does.
    enum Connection {
        /// The daemon does not answer.
        Refused,
        /// The daemon sends these events, or errors in their place, then ends the stream.
        Sends(Vec<quoll::Result<Event>>),
        /// The daemon sends no event, and ends the stream after this long.
        Opens(Duration),
    }

    /// A daemon that answers each call as the test says, then never again.
    struct FakeDaemon {
        connections: Mutex<VecDeque<Connection>>,
        filters: Mutex<Vec<String>>,
    }

    impl FakeDaemon {
        fn new(connections: impl IntoIterator<Item = Connection>) -> Self {
            Self {
                connections: Mutex::new(connections.into_iter().collect()),
                filters: Mutex::new(Vec::new()),
            }
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
                    Some(Connection::Opens(duration)) => {
                        let ends = stream::once(tokio::time::sleep(duration))
                            .filter_map(|()| future::ready(None::<quoll::Result<Event>>));

                        Ok(JsonLines::try_new(ends))
                    }
                    Some(Connection::Refused) => {
                        Err(Error::internal("the daemon is down").into_shape())
                    }
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

    /// The first `count` changes that `daemon` makes the stream give.
    async fn changes(daemon: FakeDaemon, count: usize) -> (Vec<DockerChange>, &'static FakeDaemon) {
        let daemon: &'static FakeDaemon = Box::leak(Box::new(daemon));
        let changes = Docker::follow(daemon).take(count).collect().await;

        (changes, daemon)
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
    async fn reports_every_change_once_connected_as_nothing_followed_before() {
        let daemon = FakeDaemon::new([Connection::Sends(vec![Ok(event("image", &[]))])]);

        let (changes, _) = changes(daemon, 6).await;

        assert_eq!(
            changes,
            [
                DockerChange::ALL.as_slice(),
                &[DockerChange::Images, DockerChange::Overview]
            ]
            .concat()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn asks_the_daemon_only_for_the_actions_that_change_a_read() {
        let daemon = FakeDaemon::new([Connection::Sends(Vec::new())]);

        let (_, daemon) = changes(daemon, 1).await;
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
            Err(Error::internal("not an event")),
            Ok(compose_container()),
        ])]);

        let (changes, _) = changes(daemon, 10).await;

        assert_eq!(&changes[4..8], DockerChange::ALL);
        assert_eq!(
            &changes[8..],
            [DockerChange::Containers, DockerChange::Overview]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_pausing_longer_while_each_connection_closes_at_once() {
        let daemon = FakeDaemon::new([
            Connection::Sends(Vec::new()),
            Connection::Sends(Vec::new()),
            Connection::Sends(Vec::new()),
        ]);
        let started = Instant::now();

        let (changes, _) = changes(daemon, 12).await;

        assert_eq!(changes.len(), 12);
        // No pause before the first connection, then 1 and 2 seconds: a proxy that closes right after answering
        // does not make everything reload every second.
        assert_eq!(started.elapsed(), Duration::from_secs(3));
    }

    #[tokio::test(start_paused = true)]
    async fn pauses_a_second_again_once_a_connection_gave_an_event() {
        let daemon = FakeDaemon::new([
            Connection::Sends(Vec::new()),
            Connection::Sends(vec![Ok(event("image", &[]))]),
            Connection::Sends(Vec::new()),
        ]);
        let started = Instant::now();

        let (changes, _) = changes(daemon, 14).await;

        assert_eq!(changes.len(), 14);
        // 1 second before the second connection, which gives an event, then 1 again rather than 2.
        assert_eq!(started.elapsed(), Duration::from_secs(2));
    }

    #[tokio::test(start_paused = true)]
    async fn pauses_a_second_again_once_a_connection_stayed_open() {
        let daemon: &'static FakeDaemon = Box::leak(Box::new(FakeDaemon::new([
            Connection::Sends(Vec::new()),
            Connection::Opens(STEADY),
            Connection::Sends(Vec::new()),
        ])));
        let started = Instant::now();

        let changes: Vec<DockerChange> = Docker::follow(daemon).take(12).collect().await;

        assert_eq!(changes.len(), 12);
        // 1 second, the steady connection, then 1 again rather than 2.
        assert_eq!(started.elapsed(), Duration::from_secs(2) + STEADY);
    }

    #[tokio::test(start_paused = true)]
    async fn follows_again_when_the_stream_ends_and_reports_every_change_again() {
        let daemon = FakeDaemon::new([
            Connection::Sends(vec![Ok(compose_container())]),
            Connection::Sends(Vec::new()),
        ]);

        let (changes, _) = changes(daemon, 10).await;

        assert_eq!(&changes[6..], DockerChange::ALL);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_trying_while_the_daemon_does_not_answer_pausing_longer_each_time() {
        let daemon = FakeDaemon::new([
            Connection::Refused,
            Connection::Refused,
            Connection::Refused,
            Connection::Sends(Vec::new()),
        ]);
        let started = Instant::now();

        let (changes, daemon) = changes(daemon, 4).await;

        assert_eq!(changes, DockerChange::ALL);
        assert_eq!(
            daemon
                .filters
                .lock()
                .expect("no test panics with the lock")
                .len(),
            4
        );
        // No pause before the first attempt, then 1, 2 and 4 seconds.
        assert_eq!(started.elapsed(), Duration::from_secs(7));
    }
}
