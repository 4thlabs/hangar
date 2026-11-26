//! Docker, read through a cache that the daemon's events keep fresh: the containers of the compose projects, which
//! the projects and each project's detail are made of, and the usage of the whole host. A page follows what changed,
//! once the cache holds it, or once the store installed or uninstalled an app, and reads it again. The logs and the
//! stats are streams of the daemon's, never kept.

mod cache;
mod routes;
mod stats;
mod views;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures::StreamExt;
use hangar_api::DockerChange;
use hangar_core::{ComposeContainers, Docker, DockerOverview, Runtime, Store};
use tokio::sync::broadcast;

use crate::Settings;
use crate::failure::Failure;
use cache::{Cached, Loaded, Policy};

/// What the Docker routes run on: the client of the daemon, the store, which says what is installed, and what the
/// cache keeps of the daemon. Shared: `App` holds it in an `Arc`.
#[derive(Debug)]
pub(crate) struct DockerState {
    docker: Docker,
    store: Store<Runtime>,
    containers: Arc<Cached<ComposeContainers>>,
    overview: Arc<Cached<DockerOverview>>,
    changes: DockerChanges,
    /// Set while the events of the containers wait out their batch.
    containers_batch: AtomicBool,
    /// Set while the events of the overview wait out their batch.
    overview_batch: AtomicBool,
    is_following: AtomicBool,
}

impl DockerState {
    /// How long the containers are kept, as the Waku version keeps them: the events reload them, and this is the net
    /// for a change they missed.
    const CONTAINERS: Policy = Policy {
        fresh: Duration::from_secs(60),
        stale: Duration::from_secs(120),
    };

    /// How long the overview is kept: its disk usage is the daemon's slowest call.
    const OVERVIEW: Policy = Policy {
        fresh: Duration::from_secs(300),
        stale: Duration::from_secs(3600),
    };

    /// How long the events of the containers gather before they reload them: the first opens the batch, which the
    /// others join, so that a steady trickle cannot put the reload off as a debounce would.
    const CONTAINERS_BATCH: Duration = Duration::from_millis(250);

    /// How long the events of the overview gather: its reload is slow, and its batch takes a whole `compose up`.
    const OVERVIEW_BATCH: Duration = Duration::from_secs(2);

    /// The state of `docker`, the store of the server's settings telling what is installed, and what changes sent to
    /// the pages that follow them.
    pub(crate) fn new(
        settings: &Settings,
        runtime: Runtime,
        docker: Docker,
        changes: DockerChanges,
    ) -> Arc<Self> {
        let containers = {
            let docker = docker.clone();

            Cached::new(
                "containers",
                Self::CONTAINERS,
                move || {
                    let docker = docker.clone();

                    async move { docker.containers().await }
                },
                Self::notifier(&changes, DockerChange::Containers),
            )
        };
        let overview = {
            let docker = docker.clone();

            Cached::new(
                "overview",
                Self::OVERVIEW,
                move || {
                    let docker = docker.clone();

                    async move { docker.overview().await }
                },
                Self::notifier(&changes, DockerChange::Overview),
            )
        };

        Arc::new(Self {
            docker,
            store: Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            ),
            containers,
            overview,
            changes,
            containers_batch: AtomicBool::new(false),
            overview_batch: AtomicBool::new(false),
            is_following: AtomicBool::new(false),
        })
    }

    /// What tells the pages that follow the changes that `change` happened.
    fn notifier(
        changes: &DockerChanges,
        change: DockerChange,
    ) -> impl Fn() + Send + Sync + 'static {
        let changes = changes.clone();

        move || changes.send(change)
    }

    /// The containers of every compose project, as kept.
    pub(crate) async fn containers(&self) -> Loaded<ComposeContainers> {
        self.containers.get().await
    }

    /// The usage of the whole host, as kept.
    pub(crate) async fn overview(&self) -> Loaded<DockerOverview> {
        self.overview.get().await
    }

    /// Reads the containers again after a change this server made, as a compose command, and resolves once the cache
    /// holds what the daemon runs since: a page told of the change then reads the new state. The overview is left to
    /// the events, as its disk usage is the daemon's slowest call. Readers keep what is kept meanwhile.
    pub(crate) async fn settle(&self) {
        self.containers.reload().await;
    }

    /// Follows the daemon's events, which reload what they make stale, until the server stops; once, however many
    /// times it is called. When the daemon refuses them for good, as with a 403, what is kept is reloaded each time it
    /// goes stale instead.
    pub(crate) fn follow(self: &Arc<Self>) {
        if self.is_following.swap(true, Ordering::SeqCst) {
            return;
        }

        let this = Arc::clone(self);

        tokio::spawn(async move {
            let mut events = std::pin::pin!(this.docker.events());

            while let Some(change) = events.next().await {
                match change {
                    Ok(change) => this.schedule(change),
                    Err(error) => tracing::error!(
                        error = %Failure::chain(&error),
                        "the Docker events are no longer followed: what the server keeps of the daemon is reloaded \
                         each time it goes stale"
                    ),
                }
            }

            // The events no longer say what changed: the pages, which follow what the cache changes, would wait forever.
            this.containers.poll();
            this.overview.poll();
        });
    }

    /// Reloads what `change` makes stale once its batch ends, opening one unless it is open. The images and the swarm
    /// are not kept yet.
    fn schedule(self: &Arc<Self>, change: hangar_core::DockerChange) {
        let this = Arc::clone(self);

        match change {
            hangar_core::DockerChange::Containers => {
                Self::batch(&self.containers_batch, Self::CONTAINERS_BATCH, move || {
                    this.containers_batch.store(false, Ordering::SeqCst);
                    this.containers.refresh();
                });
            }
            hangar_core::DockerChange::Overview => {
                Self::batch(&self.overview_batch, Self::OVERVIEW_BATCH, move || {
                    this.overview_batch.store(false, Ordering::SeqCst);
                    this.overview.refresh();
                });
            }
            hangar_core::DockerChange::Images | hangar_core::DockerChange::Swarm => {}
        }
    }

    /// Calls `end` once `window` has passed, unless `open` says a batch is open already, which it then joins.
    fn batch(open: &AtomicBool, window: Duration, end: impl FnOnce() + Send + 'static) {
        if open.swap(true, Ordering::SeqCst) {
            return;
        }

        tokio::spawn(async move {
            tokio::time::sleep(window).await;
            end();
        });
    }

    /// The changes from now on.
    pub(crate) fn subscribe(&self) -> broadcast::Receiver<DockerChange> {
        self.changes.subscribe()
    }
}

/// What changed of what the Docker routes give, for the pages that follow it: sent by the cache, and by the store when
/// what is installed changed. Its clones send to the same pages.
#[derive(Debug, Clone)]
pub(crate) struct DockerChanges(broadcast::Sender<DockerChange>);

impl DockerChanges {
    /// How many changes a page that reads slowly may fall behind before it reads everything again.
    const BACKLOG: usize = 16;

    pub(crate) fn new() -> Self {
        Self(broadcast::channel(Self::BACKLOG).0)
    }

    /// Tells the pages that follow the changes that `change` happened.
    pub(crate) fn send(&self, change: DockerChange) {
        // An error says no page follows the changes, which is no failure.
        let _ = self.0.send(change);
    }

    fn subscribe(&self) -> broadcast::Receiver<DockerChange> {
        self.0.subscribe()
    }
}
