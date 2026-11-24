//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. It holds its
//! version, the runtime, which runs `docker`, `docker compose` and `git`, and Docker; the store and compose come later.

mod docker;
mod runtime;
mod version;

pub use docker::{
    ComposeContainer, ComposeContainers, ComposeProjectDetail, ComposeProjectSummary,
    ComposeService, ContainerDetails, ContainerMetrics, ContainerState, DaemonError, Docker,
    DockerChange, DockerError, Health, ProjectStatus, PublishedPort, StatsFrame,
};
pub use runtime::{Command, CommandRunner, Output, OutputSink, RunError, Runtime};
pub use tokio_util::sync::CancellationToken;
pub use version::VERSION;
