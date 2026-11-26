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

    /// An id that names one of the shared files `hangar.yml` lists, not an app: its files are not the editor's.
    #[error("{id} is a shared file, not an app")]
    SharedFile {
        /// The id.
        id: String,
    },

    /// An app to create whose folder, or anything else in its place, is in the store already.
    #[error("the app {id} already exists")]
    AppExists {
        /// The id.
        id: String,
    },

    /// A path of an app's file that is not one: empty, absolute, with a NUL byte, an empty segment, or a segment that
    /// starts with a dot, as `..` or the hidden files the listing leaves out.
    #[error("invalid file path: {path:?}")]
    InvalidPath {
        /// The path, as it was given.
        path: String,
    },

    /// A path of an app's file that goes through a file as if it were a folder.
    #[error("{path} goes through a file, not a folder")]
    ThroughFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file that leads out of its folder, through a symlink.
    #[error("{path} leads outside the app {app}")]
    OutsideApp {
        /// The app.
        app: String,
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file that leads, through a symlink, to a hidden entry of its folder, which the path alone
    /// could not name.
    #[error("{path} leads to a hidden file")]
    HiddenFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A path of an app's file that goes through a symlink to nothing: writing through it would create its target,
    /// wherever it points.
    #[error("{path} is a broken symlink")]
    BrokenSymlink {
        /// The path in the app's folder, up to the symlink.
        path: String,
    },

    /// An app has no file at this path.
    #[error("the app {app} has no file {path}")]
    NoSuchFile {
        /// The app.
        app: String,
        /// The path in the app's folder.
        path: String,
    },

    /// Something that is not a regular file sits at this path, as a folder, a FIFO, or a symlink swapped in after the
    /// path was checked.
    #[error("{path} is not a file")]
    NotAFile {
        /// The path in the app's folder.
        path: String,
    },

    /// A file too large to be sent to the page whole, and saved back the same way.
    #[error("{path} is too large to edit here: {size} bytes, 1 MiB at most")]
    TooLarge {
        /// The path in the app's folder.
        path: String,
        /// Its size, in bytes.
        size: u64,
    },

    /// A binary file: a NUL byte in its first kilobytes.
    #[error("{path} is not a text file")]
    Binary {
        /// The path in the app's folder.
        path: String,
    },

    /// A file that is not UTF-8: saved from the editor, it would come back corrupted.
    #[error("{path} is not UTF-8 text: saving it from the editor would corrupt it")]
    NotUtf8Text {
        /// The path in the app's folder.
        path: String,
    },

    /// A file to create where something is already, a file the listing hides included.
    #[error("{path} already exists")]
    FileExists {
        /// The path in the app's folder.
        path: String,
    },

    /// A file found missing as it was saved, which something else created before the save could: it is left as it
    /// is, for the operator to open again.
    #[error("{path} appeared while it was being saved: reopen it before saving again")]
    FileAppeared {
        /// The path in the app's folder.
        path: String,
    },

    /// A YAML or `.env` file that does not parse: it is not written.
    #[error("{path} is not valid: {reason}")]
    InvalidFile {
        /// The path in the app's folder.
        path: String,
        /// What the parser says, in English.
        reason: String,
    },

    /// Docker rejects one of an app's compose files, `docker compose config` or `docker stack config`: it is not
    /// written.
    #[error("docker rejects {path}")]
    Rejected {
        /// The path in the app's folder.
        path: String,
        /// Docker's complaint, the last lines of its stderr, with the files of the app's folder named by their paths in
        /// it, the copy that was checked as the file it stands for.
        complaint: String,
        /// The check, a [`ComposeError::Invalid`](crate::ComposeError::Invalid) with Docker's complaint.
        #[source]
        source: Box<crate::ComposeError>,
    },

    /// Docker could not check one of an app's compose files, as when it did not start: it is not written, and may be
    /// valid.
    #[error("could not check {path}")]
    Unchecked {
        /// The path in the app's folder.
        path: String,
        /// Why the check did not run.
        #[source]
        source: Box<crate::ComposeError>,
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
