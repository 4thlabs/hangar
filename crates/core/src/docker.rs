//! Docker, through its Engine API: the containers of each compose project, their logs and stats, and the daemon's
//! events.
//!
//! [`Docker`] is the client. Each of its reads is fresh, never cached: caching them belongs to the server, which
//! follows [`Docker::events`] to know when a read went stale.
//!
//! ```no_run
//! # async fn example() -> Result<(), hangar_core::DockerError> {
//! use hangar_core::Docker;
//!
//! let docker = Docker::connect()?;
//! let containers = docker.containers().await?;
//!
//! for project in containers.summaries(["jellyfin", "miniflux"]) {
//!     println!("{}: {:?}", project.name, project.status);
//! }
//! # Ok(())
//! # }
//! ```

mod compose;
mod container;
mod engine;
mod error;
mod events;
mod frames;
mod host;
mod logs;
mod stats;

pub use compose::{
    ComposeContainers, ComposeProjectDetail, ComposeProjectSummary, ComposeService, ProjectStatus,
};
pub use container::{ComposeContainer, ContainerDetails, ContainerState, Health, PublishedPort};
pub use error::{DaemonError, DockerError};
pub use events::DockerChange;
pub use stats::{ContainerMetrics, StatsFrame};

use engine::EngineClient;
use host::Host;

/// A client of the Docker daemon that `DOCKER_HOST` names, else of Docker's own socket, `/var/run/docker.sock`.
///
/// It reaches a daemon on a Unix socket, `unix:///path`, or on TCP without TLS, `tcp://host:port`, which serve version
/// 1.44 of the Engine API, Docker 25 and later. Cloning it is cheap, and the clones share their connections.
#[derive(Debug, Clone)]
pub struct Docker {
    engine: EngineClient,
}

impl Docker {
    /// A client of the daemon that `DOCKER_HOST` names, else of Docker's own socket. It connects at its first call, so
    /// a daemon that does not answer yet is not an error here, nor a host that does not resolve: those fail the
    /// calls. A call that gets no answer within 30 seconds fails too; on a followed log and on the events, the
    /// deadline is for the head of the answer alone.
    ///
    /// # Errors
    ///
    /// - [`DockerError::UnsupportedHost`] when `DOCKER_HOST` names neither a Unix socket nor a TCP address, or a port
    ///   that is not a number from 1 to 65535;
    /// - [`DockerError::UnsupportedTls`] when `DOCKER_TLS_VERIFY` asks for TLS to a daemon on TCP;
    /// - [`DockerError::Daemon`] when the HTTP client cannot be built, as when the system's TLS settings do not load.
    pub fn connect() -> Result<Self, DockerError> {
        let engine = Host::from_env()?.client()?;

        Ok(Self { engine })
    }
}
