//! The errors of the store.

use std::io;
use std::path::PathBuf;

use crate::RunError;

use super::ConfigError;

/// A store operation that failed.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// `HANGAR_DATA_DIR` is not set, or is empty.
    #[error("{} is not set", super::DataDir::VARIABLE)]
    DataDirNotSet,

    /// A path of the data directory is not UTF-8, which the commands run on it need.
    #[error("{} is not a UTF-8 path", path.display())]
    NotUtf8 {
        /// The path.
        path: PathBuf,
    },

    /// A file or a folder of the data directory could not be read, written or linked.
    #[error("could not {action} {}", path.display())]
    Io {
        /// What was being done, such as `read`.
        action: &'static str,
        /// The path it was done on.
        path: PathBuf,
        /// The system's error.
        #[source]
        source: io::Error,
    },

    /// `git` could not clone or pull the store.
    #[error("could not {action} the store")]
    Git {
        /// `clone` or `pull`.
        action: &'static str,
        /// The failed run, with git's stderr.
        #[source]
        source: RunError,
    },

    /// `hangar.yml` is not valid: it is not read, and never written.
    #[error("invalid Hangar config at {}", path.display())]
    Config {
        /// The file.
        path: PathBuf,
        /// What is wrong with it.
        #[source]
        source: ConfigError,
    },

    /// The store carries no app of this id, or none that Hangar can read: its folder has no `compose.yml` that
    /// parses.
    #[error("the store has no app {id}")]
    UnknownApp {
        /// The id asked for.
        id: String,
    },
}

impl StoreError {
    /// A failed `action` on `path`.
    pub(crate) fn io(action: &'static str, path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            action,
            path: path.into(),
            source,
        }
    }
}
