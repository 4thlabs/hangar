//! The errors of the backups.

use std::io;
use std::path::PathBuf;

use crate::ComposeError;

/// A backup that failed, or an archive that could not be listed, read or removed.
#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    /// A name that is not an app id, which could climb out of `app-backups/`.
    #[error("{app:?} is not an app id")]
    InvalidApp {
        /// The name.
        app: String,
    },

    /// A name that is not an archive's, as `2026-10-18T03-30-00-000Z`.
    #[error("{archive:?} is not the name of an archive")]
    InvalidArchive {
        /// The name.
        archive: String,
    },

    /// The app has no such archive.
    #[error("{app} has no archive {archive}")]
    UnknownArchive {
        /// The app.
        app: String,
        /// The archive.
        archive: String,
    },

    /// The folder to back up is not there.
    #[error("{app} has no data folder to back up at {}", folder.display())]
    NoDataFolder {
        /// The app.
        app: String,
        /// The folder.
        folder: PathBuf,
    },

    /// The path of the folder to back up has an empty, `.` or `..` folder, which could lead out of `app-data/`.
    #[error("the data folder of {app} leads out of app-data: {}", folder.display())]
    OutsideAppData {
        /// The app.
        app: String,
        /// The folder, as `hangar.yml` names it.
        folder: PathBuf,
    },

    /// A symbolic link is in the path of the folder to back up: a backup follows none, as one could lead to another
    /// app's data or out of `app-data/`.
    #[error("the data folder of {app} goes through a symbolic link: {}", folder.display())]
    LinkedFolder {
        /// The app.
        app: String,
        /// The folder, as `hangar.yml` names it.
        folder: PathBuf,
    },

    /// A glob of the backup that globset cannot read, though `hangar.yml` takes any text.
    #[error("{glob:?} is not a valid glob")]
    InvalidGlob {
        /// The glob.
        glob: String,
        /// Why it is not, globset's error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// One of the services to stop runs in the container Hangar runs in: stopping it would stop its own backup.
    #[error("{app} runs Hangar itself: stopping it would stop its own backup")]
    RunsHangar {
        /// The app.
        app: String,
    },

    /// Compose could not tell the services that run, or could not stop them.
    #[error("could not stop the services of {app}")]
    NotStopped {
        /// The app.
        app: String,
        /// The compose command that failed.
        #[source]
        source: Box<ComposeError>,
    },

    /// `docker compose ps` answered what is not its JSON.
    #[error("could not read the services of {app} from docker compose ps")]
    UnreadableServices {
        /// The app.
        app: String,
        /// Why its answer does not read, serde_json's error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// The services stopped for the backup did not start again: the app is left down. The backup itself may have
    /// failed too, which `failure` says.
    #[error("{app} did not start again after its backup: {}", services.join(", "))]
    NotRestarted {
        /// The app.
        app: String,
        /// The services stopped, which did not start.
        services: Vec<String>,
        /// The failed `docker compose start`.
        #[source]
        source: Box<ComposeError>,
        /// Why the backup failed, when it did; `None` when its archive was written.
        failure: Option<Box<BackupError>>,
    },

    /// The backup was canceled: what it had written of its archive is removed.
    #[error("the backup of {app} was canceled")]
    Canceled {
        /// The app.
        app: String,
    },

    /// A file or a folder could not be read or written, or the archive could not be written.
    #[error("could not {action} {}", path.display())]
    Io {
        /// What was being done, such as `read`.
        action: &'static str,
        /// The path it was done on.
        path: PathBuf,
        /// The system's error, or the zip writer's.
        #[source]
        source: io::Error,
    },

    /// The work on the disk stopped short: it panicked.
    #[error("the backup of {app} stopped short")]
    Crashed {
        /// The app.
        app: String,
    },
}

impl BackupError {
    /// An [`Io`](Self::Io) error of `action` on `path`.
    pub(crate) fn io(action: &'static str, path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            action,
            path: path.into(),
            source,
        }
    }
}
