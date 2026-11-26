//! The store of the data directory, on the core's [`Store`]: its apps, installed or uninstalled, its `hangar.yml`,
//! `.env.global`, and the sync that clones or pulls it apart from the request.

mod apps;
mod command_log;
mod config;
mod env;
mod gate;
mod sync;

use std::sync::Arc;

use hangar_api::{ErrorCode, StoreSync};
use hangar_core::{Compose, Runtime, Store};
use tokio::sync::{Mutex, watch};

use crate::Settings;
use crate::notifications::Notifier;
use gate::{Change, ChangeGate};

/// What the routes of the store, of `hangar.yml` and of `.env.global` run on. The sync outlives the request that
/// starts it, so the state is shared: `App` holds it in an `Arc`.
#[derive(Debug)]
pub(crate) struct StoreState {
    store: Store<Runtime>,
    compose: Compose<Runtime>,
    /// The last sync since the server started, which the page reads again.
    sync: watch::Sender<Option<StoreSync>>,
    /// The changes of the store, one at a time, and none while a sync runs.
    gate: ChangeGate,
    /// Held while a sync starts, from the check that none runs to the one started: what it reads of the store, cloned
    /// or not, is then what no other sync is changing.
    starting: Mutex<()>,
    notifier: Notifier,
}

impl StoreState {
    /// The store of the server's settings, its commands, `git` and `docker compose`, run by `runtime`.
    pub(crate) fn new(settings: &Settings, runtime: Runtime) -> Arc<Self> {
        Arc::new(Self {
            store: Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime.clone(),
            ),
            compose: Compose::new(settings.data_dir.clone(), runtime),
            sync: watch::Sender::new(None),
            gate: ChangeGate::default(),
            starting: Mutex::new(()),
            notifier: Notifier::default(),
        })
    }

    /// The turn of a change of the store: `hangar.yml` saved, an app installed or uninstalled. The changes take
    /// turns; while a sync runs, a change is refused rather than wait for the network, and a sync waits for the
    /// changes in before it.
    ///
    /// # Errors
    ///
    /// A 409, `store.sync_running`, while a sync runs.
    pub(crate) async fn change(&self) -> quoll::Result<Change<'_>> {
        self.gate
            .enter()
            .await
            .ok_or_else(|| ErrorCode::SyncRunning.into())
    }
}
