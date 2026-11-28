//! The backups: a zip of an app's data folder, as its `backups:` entry in `hangar.yml` declares it, run as a job on its
//! cron or when a user asks, kept in `app-backups/<app>/`, listed, downloaded and removed.

use quoll::{Accepted, ByteStream};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::JobRun;

/// The backups of an app, as its page shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BackupStatus {
    /// Its backup as `hangar.yml` declares it; `None` when it declares none, as for an app no longer backed up whose
    /// archives are still there.
    pub plan: Option<BackupPlan>,
    /// Its archives, the newest first.
    pub archives: Vec<BackupArchive>,
    /// The run of its backup that waits or runs; `None` when none does.
    pub run: Option<JobRun>,
}

/// When and how an app is backed up, as `hangar.yml` declares it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BackupPlan {
    /// Its cron, as `0 3 * * *`; `None` for an app backed up only when a user asks.
    pub schedule: Option<String>,
    /// How many archives are kept: the oldest go once a new one is written.
    pub keep: u64,
    /// Whether its running services are stopped while their files are read, then started again.
    pub stop: bool,
}

/// An archive of an app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupArchive {
    /// Its name, the time its backup started at, as `2026-10-18T03-30-00-000Z`: what the routes of an archive take.
    pub name: String,
    /// Its size, in bytes.
    pub size: u64,
    /// When its backup started, in RFC 3339.
    pub created_at: String,
}

quoll::group! {
    /// The backups of the apps' data folders.
    #[auth(crate::Session)]
    pub group Backups {
        /// The backups of `app`: its plan, its archives and the run of its backup that waits or runs. Nothing for a
        /// name that is no app's, which could have no backup.
        GET "/backups/{app}" => status(app: &str) -> BackupStatus;

        /// Backs `app` up now, in a run of the job `backup` that waits its turn in the queue of the backups. A 404 when
        /// `hangar.yml` declares no backup of it, a 409 while a run of it waits or runs.
        POST "/backups/{app}" => back_up(app: &str) -> Accepted<JobRun>;

        /// The archive `archive` of `app`, a zip, saved as `<app>-<archive>.zip`. A 404 for an archive that is not
        /// there.
        GET "/backups/{app}/{archive}" => download(app: &str, archive: &str) -> ByteStream;

        /// Removes the archive `archive` of `app`. A 404 for an archive that is not there.
        DELETE "/backups/{app}/{archive}" => remove(app: &str, archive: &str);
    }
}
