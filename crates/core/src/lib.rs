//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. It holds its
//! version, the runtime, which runs `docker`, `docker compose` and `git`, Docker, the store, with its configuration
//! and the global environment, and compose, which brings the installed apps up and down, one or a batch.

mod compose;
mod docker;
mod runtime;
mod store;
mod version;

pub use compose::{
    AppOutcome, AppStatus, BatchEvent, BatchReport, Compose, ComposeBatch, ComposeCommand,
    ComposeError, OnFailure, UpOptions,
};
pub use docker::{
    ComposeContainer, ComposeContainers, ComposeProjectDetail, ComposeProjectSummary,
    ComposeService, ContainerDetails, ContainerMetrics, ContainerState, DaemonError, Docker,
    DockerChange, DockerError, Health, ProjectStatus, PublishedPort, StatsFrame,
};
pub use runtime::{Command, CommandRunner, Output, RunError, Runtime};
pub use store::{
    Backup, Category, Column, Config, ConfigError, DataDir, Dotenv, FollowedCard, GlobalEnv,
    ServiceOptions, Store, StoreApp, StoreError, Widget, WidgetKind, YamlError,
};
pub use tokio_util::sync::CancellationToken;
pub use version::VERSION;
