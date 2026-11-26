//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. It holds its
//! version, the environment both read their variables from, the runtime, which runs `docker`, `docker compose` and
//! `git`, Docker, the store, with its configuration, its users and the global environment, the hashes of their
//! passwords, and compose, which brings the installed apps up and down, one or a batch.

mod compose;
mod docker;
mod environment;
mod password;
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
pub use environment::Environment;
pub use password::{PasswordError, PasswordHash};
pub use runtime::{Command, CommandRunner, Output, RunError, Runtime};
pub use store::{
    AppFiles, Backup, Category, Column, Config, ConfigError, DataDir, Dotenv, FollowedCard,
    GlobalEnv, SavedFile, ServiceOptions, Store, StoreApp, StoreError, User, Widget, WidgetKind,
    YamlError,
};
pub use tokio_util::sync::CancellationToken;
pub use version::VERSION;
