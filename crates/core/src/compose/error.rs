//! The errors of compose.

use std::path::PathBuf;

use crate::RunError;

use super::ComposeCommand;

/// A compose command that failed, or that was refused before it ran.
#[derive(Debug, thiserror::Error)]
pub enum ComposeError {
    /// A name that `docker compose -p` does not take as a project: lowercase letters, digits, `_` and `-`, starting
    /// with a letter or a digit. A store app may have one, as `llama.cpp`, and compose cannot run it.
    #[error("{app:?} is not a compose project name")]
    InvalidProject {
        /// The name.
        app: String,
    },

    /// The app is not installed: `app-installed/` has no `compose.yml` for it.
    #[error("the app {app} is not installed")]
    NotInstalled {
        /// The app.
        app: String,
    },

    /// A command passed as its arguments starts with an option rather than its name, which compose would take for one
    /// of its own, as `-p` or `-f` that would override the app's project or file.
    #[error("{option} comes before the compose command: put it after the command's name")]
    OptionBeforeCommand {
        /// The option.
        option: String,
    },

    /// A batch was asked for no app.
    #[error("a batch needs at least one app")]
    EmptyBatch,

    /// A batch was asked for an `up` that is not detached on several apps: it attaches to the first one and never
    /// gets to the others.
    #[error("{command} is not detached: it runs on one app alone, add -d to run it on several")]
    AttachedBatch {
        /// The command.
        command: ComposeCommand,
    },

    /// A path given to compose is not UTF-8, which its arguments need.
    #[error("{} is not a UTF-8 path", path.display())]
    NotUtf8 {
        /// The path.
        path: PathBuf,
    },

    /// `docker compose` failed on the app.
    #[error("{command} failed on {app}")]
    Failed {
        /// The app.
        app: String,
        /// The command.
        command: ComposeCommand,
        /// The failed run, with compose's stderr.
        #[source]
        source: RunError,
    },

    /// `docker compose config` rejects the file: it exited with a non-zero code.
    #[error("docker compose rejects {}", file.display())]
    Invalid {
        /// The file.
        file: PathBuf,
        /// The failed run, a [`RunError::Failed`] with compose's complaint in its stderr.
        #[source]
        source: RunError,
    },

    /// `docker compose config` could not check the file: docker did not start, or the run was cancelled, killed or
    /// interrupted. The file may be valid.
    #[error("could not check {}", file.display())]
    Unchecked {
        /// The file.
        file: PathBuf,
        /// Why the run did not check it.
        #[source]
        source: RunError,
    },
}
