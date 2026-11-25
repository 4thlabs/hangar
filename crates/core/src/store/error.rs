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

    /// The store is not cloned yet, which this needs.
    #[error("the store is not installed")]
    NotInstalled,

    /// A name that would not stay a single entry of `app-installed/` or `store/`: empty, `.`, `..`, absolute, or with
    /// a separator.
    #[error("{name:?} is not the name of an app or of a shared file")]
    InvalidName {
        /// The name.
        name: String,
    },

    /// An id that is not an app's: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit.
    #[error("{id:?} is not an app id")]
    InvalidAppId {
        /// The id.
        id: String,
    },

    /// Something that is not a link to the store sits where an app's link goes, in `app-installed/`: it is left as
    /// it is.
    #[error("{} is in the way: it is not a link to the store", path.display())]
    InTheWay {
        /// What is in the way.
        path: PathBuf,
    },

    /// A variable name that compose does not accept, which `.env.global` is not given.
    #[error("{key:?} is not a variable name")]
    InvalidVariable {
        /// The name.
        key: String,
    },

    /// A value that no quoting writes so that dotenv reads it back the same: one that holds every kind of quote, and
    /// a newline or a `#`.
    #[error("the value of {key} cannot be written to .env.global")]
    UnwritableValue {
        /// The variable.
        key: String,
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
