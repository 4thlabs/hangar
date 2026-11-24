//! The errors of the Docker client.

use std::fmt;

use super::engine::EngineMessage;

/// What the daemon answers for a subject that does not exist, such as a container gone between a list and a call on
/// it.
const NOT_FOUND: u16 = 404;

/// How Docker's message for a container that does not exist starts, `No such container: 3f2a…`, in lowercase.
const DOCKER_NO_SUCH_CONTAINER: &str = "no such container";

/// How Podman's message for a container that does not exist ends, `no container with name or ID "web" found: no such
/// container`, in lowercase.
const PODMAN_NO_SUCH_CONTAINER: &str = ": no such container";

/// A Docker call that failed.
#[derive(Debug, thiserror::Error)]
pub enum DockerError {
    /// The subject does not exist, or is not one the caller may see, such as a container of another project.
    #[error("{subject} not found")]
    NotFound {
        /// What was looked for, such as `container 3f2a…`.
        subject: String,
    },

    /// `DOCKER_HOST` names a daemon that Hangar does not reach.
    #[error("DOCKER_HOST is `{docker_host}`, {reason}")]
    UnsupportedHost {
        /// The value of `DOCKER_HOST`.
        docker_host: String,
        /// Why it is not reached, and what to write instead.
        reason: &'static str,
    },

    /// `DOCKER_TLS_VERIFY` asks for TLS to a daemon on TCP, which Hangar does not speak.
    #[error("DOCKER_TLS_VERIFY is set: Hangar reaches a daemon on TCP without TLS only")]
    UnsupportedTls,

    /// The daemon could not be reached, or answered with an error.
    #[error("could not {action}")]
    Daemon {
        /// What was being done, such as `list the containers`.
        action: &'static str,
        /// The daemon's or the connection's error.
        #[source]
        source: DaemonError,
    },
}

/// The error of the daemon or of the connection to it, behind a [`DockerError::Daemon`]: the status of the answer and
/// Docker's message, as `another api answered 404: No such container: web`, or the bytes of a log that are not
/// Docker's frames. Its type stays private, so that the client can be replaced.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct DaemonError(Box<dyn std::error::Error + Send + Sync>);

impl DockerError {
    /// A subject that does not exist.
    pub(crate) fn not_found(subject: impl Into<String>) -> Self {
        Self::NotFound {
            subject: subject.into(),
        }
    }

    /// A call to the daemon that failed while doing `action`.
    pub(crate) fn daemon(
        action: &'static str,
        error: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Daemon {
            action,
            source: DaemonError(Box::new(error)),
        }
    }

    /// Whether the daemon answered that the container does not exist: one that went away mid-read, which a read of
    /// many containers expects: a 404 whose message starts as Docker's or ends as Podman's, in any case. Another 404
    /// is not one: a proxy in front of the daemon may answer it for a call it does not let through.
    pub(crate) fn is_gone(error: &quoll::Error<EngineMessage>) -> bool {
        let is_not_found = error
            .status()
            .is_some_and(|status| status.as_u16() == NOT_FOUND);
        let says_no_such_container = error.detail().is_some_and(|detail| {
            let message = detail.message.to_ascii_lowercase();

            message.starts_with(DOCKER_NO_SUCH_CONTAINER)
                || message.ends_with(PODMAN_NO_SUCH_CONTAINER)
        });

        is_not_found && says_no_such_container
    }

    /// Whether the daemon answered with a body that does not read as the call's result, such as an event of a kind
    /// newer than Hangar: the connection works. It leans on the source of quoll's error being the JSON's error,
    /// which quoll does not promise: [quoll#126](https://github.com/4thlabs/quoll/issues/126) asks for a public way
    /// to tell it.
    pub(crate) fn is_undecoded<E: fmt::Debug>(error: &quoll::Error<E>) -> bool {
        std::error::Error::source(error).is_some_and(|source| source.is::<serde_json::Error>())
    }
}
