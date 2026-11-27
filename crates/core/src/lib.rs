//! The core of Hangar, on no web framework, so that the `hangar` binary and the server both run on it. It holds its
//! version, the environment both read their variables from, the runtime, which runs `docker`, `docker compose` and
//! `git`, Docker, the store, with its configuration, its users and the global environment, the hashes of their
//! passwords, compose, which brings the installed apps up and down, one or a batch, the backups of the apps' data, and
//! the secrets a command's output may echo, taken out before it is shown.

mod backups;
mod compose;
mod docker;
mod environment;
mod password;
mod runtime;
mod secrets;
mod store;
mod version;

pub use backups::{AppBackups, ArchiveFile, BackupArchive, BackupError, BackupSummary};
pub use compose::{
    AppOutcome, AppStatus, BatchEvent, BatchReport, Compose, ComposeBatch, ComposeCommand,
    ComposeError, OnFailure, UpOptions,
};
pub use docker::{
    ComposeContainer, ComposeContainers, ComposeProjectDetail, ComposeProjectSummary,
    ComposeService, ContainerCounts, ContainerDetails, ContainerMetrics, ContainerState,
    DaemonError, Docker, DockerChange, DockerError, DockerOverview, Health, ImageCounts,
    ImageDigests, ProjectStatus, PublishedPort, RegistryDigests, RunningImage, StatsFrame,
    VolumeCounts,
};
pub use environment::Environment;
pub use password::{PasswordError, PasswordHash};
pub use runtime::{Command, CommandRunner, Output, RunError, Runtime};
pub use secrets::Secrets;
pub use store::{
    AppFiles, Backup, Category, Column, Config, ConfigError, CronError, CronSchedule, DataDir,
    Dotenv, FollowedCard, GlobalEnv, SavedFile, ServiceOptions, Store, StoreApp, StoreError, User,
    Widget, WidgetKind, YamlError,
};
pub use tokio_util::sync::CancellationToken;
pub use version::VERSION;
