//! How a command fails, what it says and the code the binary exits with.

use std::error::Error;
use std::io;
use std::process::ExitCode;
use std::sync::Arc;

use hangar_core::{ComposeError, RunError, StoreError};

/// A command that failed, or that was refused before it ran.
#[derive(Debug, thiserror::Error)]
pub(crate) enum Failure {
    /// A variable the command needs is not set, empty, or not Unicode.
    #[error("{variable} is not set")]
    NotSet {
        /// The variable.
        variable: &'static str,
    },

    /// The `.env` of the working directory is there but cannot be read.
    #[error("could not read .env")]
    Dotenv(#[source] io::Error),

    /// The Tokio runtime did not start.
    #[error("could not start")]
    Startup(#[source] io::Error),

    /// `store` was given no target, which clap does not let happen.
    #[error("name a target: an app, a category, or pull")]
    NoTarget,

    /// The store failed.
    #[error(transparent)]
    Store(#[from] StoreError),

    /// Compose failed, or refused the command, before any app ran.
    #[error(transparent)]
    Compose(#[from] ComposeError),

    /// A compose batch failed on an app: the first one, in the order the batch ran them in.
    #[error(transparent)]
    Batch(Arc<ComposeError>),

    /// A batch ended without running on these apps, with no failure of its own: its task ended before.
    #[error("the batch did not run on {}", apps.join(", "))]
    NotRun {
        /// The apps.
        apps: Vec<String>,
    },

    /// A command run as it is, as `docker compose ls`, failed.
    #[error(transparent)]
    Run(#[from] RunError),

    /// Docker failed a compose command, and has no `compose` command: its plugin is not installed.
    #[error("docker compose is not installed")]
    NoCompose(#[source] Box<Failure>),
}

impl Failure {
    /// The code a shell gives this failure: that of the child that failed, as [`RunError::exit_code`] says, 1
    /// otherwise.
    pub(crate) fn exit_code(&self) -> i32 {
        match self {
            Self::Run(error) => error.exit_code(),
            Self::Store(StoreError::Git { source, .. }) => source.exit_code(),
            Self::Compose(error) => Self::compose_exit_code(error),
            Self::Batch(error) => Self::compose_exit_code(error),
            Self::NoCompose(failure) => failure.exit_code(),
            _ => 1,
        }
    }

    /// Logs the failure, and returns the code to exit with.
    pub(crate) fn report(&self) -> ExitCode {
        tracing::error!("{}", self.message());

        Self::exit(self.exit_code())
    }

    /// Whether a program the command ran exited with an error code, as docker does when it has no `compose`.
    pub(crate) fn has_exited_with_error(&self) -> bool {
        self.causes()
            .any(|cause| matches!(cause.downcast_ref(), Some(RunError::Failed { .. })))
    }

    /// What the binary says of the failure: the failure, then its causes. A compose that exited with a code says
    /// which app failed and the code alone, as its stderr went with a batch's output, or on the terminal it inherited,
    /// already; any other cause, as a `docker` that does not start, is said in full, as it was printed nowhere.
    fn message(&self) -> String {
        // Its cause is said in its own words, which keep a compose failure to its app and its code.
        if let Self::NoCompose(failure) = self {
            return format!("{self}: {}", failure.message());
        }

        let compose = match self {
            Self::Compose(error) => Some(error),
            Self::Batch(error) => Some(error.as_ref()),
            _ => None,
        };

        if let Some(
            error @ ComposeError::Failed {
                source: RunError::Failed { .. },
                ..
            },
        ) = compose
        {
            return format!("{error}, exit {}", self.exit_code());
        }

        let mut messages = Vec::new();

        for cause in self.causes() {
            if let Some(program) = Self::missing_program(cause) {
                messages.push(format!("{program} is not installed, or not on the PATH"));
                break;
            }

            messages.push(cause.to_string());
        }

        messages.join(": ")
    }

    /// The failure, then its causes. A run's failure is its own first cause: being transparent, it would skip itself.
    fn causes(&self) -> impl Iterator<Item = &(dyn Error + 'static)> {
        let failure: &(dyn Error + 'static) = match self {
            Self::Run(error) => error,
            _ => self,
        };

        std::iter::successors(Some(failure), |&cause| cause.source())
    }

    /// The program `cause` could not start because the system found no file of that name, in place of the system's
    /// own "No such file or directory": a `docker` or a `git` that is not installed.
    fn missing_program<'a>(cause: &'a (dyn Error + 'static)) -> Option<&'a str> {
        match cause.downcast_ref() {
            Some(RunError::Spawn { program, source })
                if source.kind() == io::ErrorKind::NotFound =>
            {
                Some(program)
            }
            _ => None,
        }
    }

    /// The exit code `code` stands for: a code a process cannot exit with is 1.
    pub(crate) fn exit(code: i32) -> ExitCode {
        u8::try_from(code).map_or(ExitCode::FAILURE, ExitCode::from)
    }

    fn compose_exit_code(error: &ComposeError) -> i32 {
        match error {
            ComposeError::Failed { source, .. } => source.exit_code(),
            _ => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::sync::Arc;

    use hangar_core::{ComposeCommand, ComposeError, RunError, StoreError};

    use super::Failure;

    fn failed(code: i32) -> RunError {
        RunError::Failed {
            program: "docker".into(),
            code,
            stderr: "no such image".into(),
        }
    }

    #[test]
    fn exits_with_the_code_of_the_child_that_failed() {
        let batch = Failure::Batch(Arc::new(ComposeError::Failed {
            app: "jellyfin".into(),
            command: ComposeCommand::Down,
            source: failed(17),
        }));
        let git = Failure::Store(StoreError::Git {
            action: "pull",
            source: failed(128),
        });

        assert_eq!(batch.exit_code(), 17);
        assert_eq!(
            batch.message(),
            "docker compose down failed on jellyfin, exit 17"
        );
        assert_eq!(git.exit_code(), 128);
        assert_eq!(Failure::NoTarget.exit_code(), 1);
    }

    fn spawn_error(kind: io::ErrorKind) -> RunError {
        RunError::Spawn {
            program: "docker".into(),
            source: io::Error::from(kind),
        }
    }

    #[test]
    fn says_why_compose_did_not_start() {
        let batch = Failure::Batch(Arc::new(ComposeError::Failed {
            app: "jellyfin".into(),
            command: ComposeCommand::Restart,
            source: spawn_error(io::ErrorKind::PermissionDenied),
        }));

        assert_eq!(
            batch.message(),
            "docker compose restart failed on jellyfin: could not run docker: permission denied"
        );
        assert_eq!(batch.exit_code(), 1);
    }

    #[test]
    fn says_that_a_program_it_does_not_find_is_not_installed() {
        let batch = Failure::Batch(Arc::new(ComposeError::Failed {
            app: "jellyfin".into(),
            command: ComposeCommand::Restart,
            source: spawn_error(io::ErrorKind::NotFound),
        }));
        let list = Failure::Run(spawn_error(io::ErrorKind::NotFound));

        assert_eq!(
            batch.message(),
            "docker compose restart failed on jellyfin: docker is not installed, or not on the PATH"
        );
        assert_eq!(
            list.message(),
            "docker is not installed, or not on the PATH"
        );
        assert_eq!(list.exit_code(), 1);
    }

    #[test]
    fn says_that_compose_is_not_installed_after_its_failure() {
        let failure = Failure::Compose(ComposeError::Failed {
            app: "jellyfin".into(),
            command: ComposeCommand::Restart,
            source: failed(1),
        });

        assert!(failure.has_exited_with_error());

        let no_compose = Failure::NoCompose(Box::new(failure));

        assert_eq!(
            no_compose.message(),
            "docker compose is not installed: docker compose restart failed on jellyfin, exit 1"
        );
        assert_eq!(no_compose.exit_code(), 1);
        assert!(
            no_compose.has_exited_with_error(),
            "the chain goes on to its cause"
        );
        assert!(!Failure::Run(spawn_error(io::ErrorKind::NotFound)).has_exited_with_error());
    }

    #[test]
    fn says_which_app_a_command_passed_through_failed_on_and_its_code() {
        let logs = Failure::Compose(ComposeError::Failed {
            app: "jellyfin".into(),
            command: ComposeCommand::Args(vec!["logs".into(), "-f".into()]),
            source: RunError::Failed {
                program: "docker".into(),
                code: 130,
                stderr: String::new(),
            },
        });

        assert_eq!(logs.exit_code(), 130);
        assert_eq!(
            logs.message(),
            "docker compose logs -f failed on jellyfin, exit 130"
        );
    }

    #[test]
    fn exits_with_130_once_interrupted() {
        let interrupted = Failure::Run(RunError::Interrupted {
            program: "docker".into(),
        });

        assert_eq!(interrupted.exit_code(), 130);
    }
}
