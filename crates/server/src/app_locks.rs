//! The installed apps that a command holds, a compose batch over them, an install or an uninstall of one, or a backup
//! that stops its services, so that two never run on one app at once, and the store's sync, which no batch and no such
//! backup runs beside. An uninstall's `down` then its unlink, with an `up` of a batch between them, would leave a stack
//! running that no installed app manages; a sync pulls and links the files a batch's compose reads, and the
//! `compose.yml` a backup starts the services it stopped from; an `up` while a backup has stopped the services would
//! zip a live database, and a `down` would make its start fail.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, PoisonError};

use hangar_api::ErrorCode;

/// The apps held, each by one command at a time, and whether a sync runs, read and changed together. Shared by the
/// store and compose: `App` holds it in an `Arc`.
#[derive(Debug, Default)]
pub(crate) struct AppLocks {
    state: Mutex<Held>,
}

/// What is held.
#[derive(Debug, Default)]
struct Held {
    /// The apps the compose batches hold.
    batches: BTreeSet<String>,
    /// The apps an install or an uninstall holds.
    changes: BTreeSet<String>,
    /// The apps a backup that stops their services holds.
    backups: BTreeSet<String>,
    /// Whether a sync of the store runs.
    is_syncing: bool,
}

/// Who holds an app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Holder {
    /// A compose batch.
    Batch,
    /// An install or an uninstall.
    Change,
    /// A backup that stops the services.
    Backup,
}

/// The apps a command holds, until it is dropped.
#[derive(Debug)]
pub(crate) struct AppClaim {
    locks: Arc<AppLocks>,
    holder: Holder,
    apps: Vec<String>,
}

/// A sync of the store, which no batch runs beside, until it is dropped.
#[derive(Debug)]
pub(crate) struct SyncClaim {
    locks: Arc<AppLocks>,
}

impl AppLocks {
    /// Holds each of `apps` for a compose batch, all of them or none.
    ///
    /// # Errors
    ///
    /// A 409, `compose.app_busy`, naming the first app another command holds, or the first app while a sync of the
    /// store runs; none is held then.
    pub(crate) fn claim_batch<'a>(
        self: &Arc<Self>,
        apps: impl IntoIterator<Item = &'a str>,
    ) -> Result<AppClaim, ErrorCode> {
        let apps = Self::sorted(apps);
        let mut held = self.held();
        let busy = if held.is_syncing {
            apps.first()
        } else {
            apps.iter().find(|app| held.holds(app))
        };

        if let Some(busy) = busy {
            tracing::warn!(app = %busy, is_syncing = held.is_syncing, "a compose batch was refused: its app is busy");

            return Err(ErrorCode::AppBusy { app: busy.clone() });
        }

        held.batches.extend(apps.iter().cloned());

        Ok(self.claimed(Holder::Batch, apps))
    }

    /// Holds `app` for its install or its uninstall, which take their turn with a sync of the store apart.
    ///
    /// # Errors
    ///
    /// A 409, `compose.app_busy`, when another command holds it.
    pub(crate) fn claim_change(self: &Arc<Self>, app: &str) -> Result<AppClaim, ErrorCode> {
        let mut held = self.held();

        if held.holds(app) {
            tracing::warn!(%app, "an install or an uninstall was refused: another command holds its app");

            return Err(ErrorCode::AppBusy {
                app: app.to_owned(),
            });
        }

        held.changes.insert(app.to_owned());

        Ok(self.claimed(Holder::Change, vec![app.to_owned()]))
    }

    /// Holds `app` for a backup that stops its services, from before it reads which run to after it starts them again.
    /// It runs beside no sync of the store, as a batch does: a pull could rewrite or remove the `compose.yml` it starts
    /// the services again from.
    ///
    /// # Errors
    ///
    /// A 409, `compose.app_busy`, when another command holds it or a sync of the store runs.
    pub(crate) fn claim_backup(self: &Arc<Self>, app: &str) -> Result<AppClaim, ErrorCode> {
        let mut held = self.held();

        if held.is_syncing || held.holds(app) {
            tracing::warn!(%app, is_syncing = held.is_syncing, "a backup was refused: its app is busy");

            return Err(ErrorCode::AppBusy {
                app: app.to_owned(),
            });
        }

        held.backups.insert(app.to_owned());

        Ok(self.claimed(Holder::Backup, vec![app.to_owned()]))
    }

    /// Marks a sync of the store running, which no batch and no backup that stops services runs beside.
    ///
    /// # Errors
    ///
    /// A 409, `store.batch_running`, naming the apps the batches and those backups hold.
    pub(crate) fn claim_sync(self: &Arc<Self>) -> Result<SyncClaim, ErrorCode> {
        let mut held = self.held();

        if !held.batches.is_empty() || !held.backups.is_empty() {
            let apps: Vec<String> = held.batches.union(&held.backups).cloned().collect();

            tracing::warn!(apps = %apps.join(", "), "a sync of the store was refused: compose batches or backups run");

            return Err(ErrorCode::BatchRunning { apps });
        }

        held.is_syncing = true;

        Ok(SyncClaim {
            locks: Arc::clone(self),
        })
    }

    /// `apps` once each, in order.
    fn sorted<'a>(apps: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        let apps: BTreeSet<&str> = apps.into_iter().collect();

        apps.into_iter().map(str::to_owned).collect()
    }

    fn claimed(self: &Arc<Self>, holder: Holder, apps: Vec<String>) -> AppClaim {
        AppClaim {
            locks: Arc::clone(self),
            holder,
            apps,
        }
    }

    /// What is held, whatever a panic left it: each claim and release is written whole.
    fn held(&self) -> std::sync::MutexGuard<'_, Held> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Held {
    /// Whether a command holds `app`.
    fn holds(&self, app: &str) -> bool {
        self.batches.contains(app) || self.changes.contains(app) || self.backups.contains(app)
    }
}

impl Drop for AppClaim {
    fn drop(&mut self) {
        let mut held = self.locks.held();
        let apps = match self.holder {
            Holder::Batch => &mut held.batches,
            Holder::Change => &mut held.changes,
            Holder::Backup => &mut held.backups,
        };

        for app in &self.apps {
            apps.remove(app);
        }
    }
}

impl Drop for SyncClaim {
    fn drop(&mut self) {
        self.locks.held().is_syncing = false;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use hangar_api::ErrorCode;

    use super::AppLocks;

    fn busy(app: &str) -> ErrorCode {
        ErrorCode::AppBusy {
            app: app.to_owned(),
        }
    }

    #[test]
    fn holds_an_app_for_one_command_at_a_time_and_all_its_apps_or_none() {
        let locks = Arc::new(AppLocks::default());
        let batch = locks
            .claim_batch(["alpha", "beta"])
            .expect("nothing is held");

        assert_eq!(
            locks
                .claim_batch(["gamma", "beta"])
                .expect_err("beta is held"),
            busy("beta")
        );
        assert_eq!(
            locks.claim_change("alpha").expect_err("alpha is held"),
            busy("alpha")
        );
        assert!(
            locks.claim_batch(["gamma"]).is_ok(),
            "the refused claim held nothing"
        );

        drop(batch);

        assert!(locks.claim_batch(["alpha", "beta"]).is_ok(), "released");
    }

    #[test]
    fn runs_no_batch_beside_a_sync_and_no_sync_beside_a_batch() {
        let locks = Arc::new(AppLocks::default());
        let change = locks.claim_change("alpha").expect("nothing is held");
        let sync = locks
            .claim_sync()
            .expect("an install takes its turn with a sync apart");

        assert_eq!(
            locks
                .claim_batch(["gamma", "beta"])
                .expect_err("a sync runs"),
            busy("beta")
        );

        drop((sync, change));

        let batch = locks.claim_batch(["gamma", "beta"]).expect("nothing runs");

        assert_eq!(
            locks.claim_sync().expect_err("a batch runs"),
            ErrorCode::BatchRunning {
                apps: vec!["beta".to_owned(), "gamma".to_owned()]
            }
        );

        drop(batch);

        assert!(locks.claim_sync().is_ok());
    }

    #[test]
    fn holds_the_app_of_a_backup_apart_from_every_other_command() {
        let locks = Arc::new(AppLocks::default());
        let backup = locks.claim_backup("alpha").expect("nothing is held");

        assert_eq!(
            locks
                .claim_batch(["gamma", "alpha"])
                .expect_err("a backup holds alpha"),
            busy("alpha")
        );
        assert_eq!(
            locks.claim_change("alpha").expect_err("held"),
            busy("alpha")
        );
        assert_eq!(
            locks.claim_backup("alpha").expect_err("held"),
            busy("alpha")
        );

        let batch = locks.claim_batch(["gamma"]).expect("gamma is free");

        assert_eq!(
            locks.claim_sync().expect_err("a batch and a backup run"),
            ErrorCode::BatchRunning {
                apps: vec!["alpha".to_owned(), "gamma".to_owned()]
            }
        );

        drop((batch, backup));

        let sync = locks.claim_sync().expect("released");

        assert_eq!(
            locks.claim_backup("alpha").expect_err("a sync runs"),
            busy("alpha")
        );

        drop(sync);

        assert!(locks.claim_backup("alpha").is_ok(), "released");
    }
}
