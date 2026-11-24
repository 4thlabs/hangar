//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. It holds its
//! version and Docker; running commands, the store and compose come later.

mod docker;
mod version;

pub use docker::{
    ComposeContainer, ComposeContainers, ComposeProjectDetail, ComposeProjectSummary,
    ComposeService, ContainerMetrics, ContainerState, DaemonError, Docker, DockerChange,
    DockerError, Health, ProjectStatus, PublishedPort, StatsFrame,
};
pub use version::VERSION;
