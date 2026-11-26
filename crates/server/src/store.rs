//! The store of the data directory, on the core's [`Store`]: its apps, installed or uninstalled, its `hangar.yml`,
//! `.env.global`, and the sync that clones or pulls it apart from the request.

mod apps;
mod command_log;
mod config;
mod env;
mod sync;

use std::sync::Arc;

use hangar_api::{ErrorCode, StoreSync};
use hangar_core::{Compose, Runtime, Store};
use tokio::sync::{Mutex, MutexGuard, watch};

use crate::Settings;
use crate::notifications::Notifier;

/// What the routes of the store, of `hangar.yml` and of `.env.global` run on. The sync outlives the request that
/// starts it, so the state is shared: `App` holds it in an `Arc`.
#[derive(Debug)]
pub(crate) struct StoreState {
    store: Store<Runtime>,
    compose: Compose<Runtime>,
    /// The last sync since the server started, which the page reads again.
    sync: watch::Sender<Option<StoreSync>>,
    /// Held by a sync for its whole run, and by each change of the store for its own: a save of `hangar.yml` during a
    /// pull could fail the pull or be lost, an install racing the links of a sync could fail though it installed.
    changes: Mutex<()>,
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
            changes: Mutex::new(()),
            notifier: Notifier::default(),
        })
    }

    /// The turn of a change of the store: `hangar.yml` saved, an app installed or uninstalled. The changes take
    /// turns; while a sync runs, a change is refused rather than wait for the network.
    ///
    /// # Errors
    ///
    /// A 409, `store.sync_running`, while a sync runs.
    pub(crate) async fn change(&self) -> quoll::Result<MutexGuard<'_, ()>> {
        if self.is_syncing() {
            return Err(ErrorCode::SyncRunning.into());
        }

        Ok(self.changes.lock().await)
    }
}
