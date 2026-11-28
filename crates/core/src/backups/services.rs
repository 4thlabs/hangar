//! The services a backup stops while it reads their files, and starts again after: the very containers `docker compose
//! ps` listed, stopped and started by their ids, so that a compose file changed or removed meanwhile, by a sync of the
//! store, the editor, or a shared file it includes, cannot keep them from starting again.

use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

use super::BackupError;
use crate::{Command, CommandRunner, Compose, ComposeCommand, ComposeError, RunError};

/// A container `docker compose ps` lists.
#[derive(Debug, Deserialize)]
struct ListedContainer {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Service")]
    service: String,
}

/// The services of an app, stopped for its backup and started again after, but never the container Hangar runs in.
#[derive(Debug, Clone)]
pub(super) struct Services {
    /// The hostname of this process when it is shaped like a container's short id, as Docker gives a container: the
    /// container Hangar runs in. `None` out of a container, or in one on the host's network or given a hostname of its
    /// own, which Hangar cannot tell.
    own_container: Option<String>,
}

/// The containers a backup stopped, which it starts again: their ids, in the order compose listed them, and their
/// services, each once, which a failure names.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Stopped {
    ids: Vec<String>,
    services: Vec<String>,
}

impl Stopped {
    /// Whether no container was stopped.
    pub(super) fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The services stopped, each once.
    pub(super) fn into_services(self) -> Vec<String> {
        self.services
    }
}

impl Services {
    /// The services of the apps, the container Hangar runs in told by `hostname`.
    pub(super) fn new(hostname: Option<String>) -> Self {
        static SHORT_ID: LazyLock<Regex> =
            LazyLock::new(|| Regex::new("^[0-9a-f]{12}$").expect("the pattern is valid"));

        // Only a hostname shaped like a short id can name a container: a host called `cafe` would match some.
        Self {
            own_container: hostname.filter(|hostname| SHORT_ID.is_match(hostname)),
        }
    }

    /// The hostname of this process, when it can be read.
    pub(super) fn hostname() -> Option<String> {
        nix::unistd::gethostname()
            .ok()
            .and_then(|name| name.into_string().ok())
    }

    /// Stops the containers of `app` that run or restart, with `docker stop`, each with the grace and the signal
    /// compose gave it, and gives them: the ones to start again. None for an app compose runs nothing of. A `stop`
    /// that fails may have stopped some of them already: they are all started again before it fails.
    ///
    /// # Errors
    ///
    /// [`BackupError::RunsHangar`] when one runs in the container Hangar runs in, before anything is stopped,
    /// [`BackupError::UnreadableServices`] when compose's list does not read, [`BackupError::NotStopped`] when compose
    /// fails to list them or docker to stop them, and [`BackupError::NotRestarted`], its failure the
    /// [`BackupError::NotStopped`], when they do not start again after a `stop` that failed.
    pub(super) async fn stop<R: CommandRunner>(
        &self,
        compose: &Compose<R>,
        app: &str,
    ) -> Result<Stopped, BackupError> {
        let running = self.running(compose, app).await?;

        if running.is_empty() {
            return Ok(running);
        }

        let Err(stop) = Self::docker(compose.runner(), "stop", &running.ids).await else {
            return Ok(running);
        };
        let not_stopped = BackupError::NotStopped {
            app: app.to_owned(),
            source: Box::new(stop),
        };

        match Self::start(compose, &running).await {
            Ok(()) => Err(not_stopped),
            Err(start) => Err(BackupError::NotRestarted {
                app: app.to_owned(),
                services: running.into_services(),
                source: Box::new(start),
                failure: Some(Box::new(not_stopped)),
            }),
        }
    }

    /// Starts again the containers a backup `stopped`, with `docker start`, by their ids: whatever their compose file
    /// says by now.
    ///
    /// # Errors
    ///
    /// The failed `docker start` when they do not start.
    pub(super) async fn start<R: CommandRunner>(
        compose: &Compose<R>,
        stopped: &Stopped,
    ) -> Result<(), RunError> {
        Self::docker(compose.runner(), "start", &stopped.ids).await
    }

    /// Runs `docker <name> <ids...>`.
    async fn docker<R: CommandRunner>(
        runner: &R,
        name: &str,
        ids: &[String],
    ) -> Result<(), RunError> {
        runner
            .capture(&Command::new("docker").arg(name).args(ids))
            .await
            .map(drop)
    }

    /// The containers of `app` that run, or restart between the attempts of their restart policy, and their services:
    /// one left out would come back on its own and write while its files are read.
    async fn running<R: CommandRunner>(
        &self,
        compose: &Compose<R>,
        app: &str,
    ) -> Result<Stopped, BackupError> {
        let listed = compose
            .capture(
                app,
                ComposeCommand::Args(
                    [
                        "ps",
                        "--status",
                        "running",
                        "--status",
                        "restarting",
                        "--format",
                        "json",
                    ]
                    .map(str::to_owned)
                    .into(),
                ),
            )
            .await;
        let stdout = match listed {
            Ok(stdout) => stdout,
            // Compose can run nothing of an app it cannot take as a project, or that is not installed.
            Err(ComposeError::InvalidProject { .. } | ComposeError::NotInstalled { .. }) => {
                return Ok(Stopped::default());
            }
            Err(source) => {
                return Err(BackupError::NotStopped {
                    app: app.to_owned(),
                    source: Box::new(source),
                });
            }
        };
        let containers =
            Self::parse(&stdout).map_err(|source| BackupError::UnreadableServices {
                app: app.to_owned(),
                source: Box::new(source),
            })?;
        let is_own = |container: &ListedContainer| {
            self.own_container
                .as_ref()
                .is_some_and(|own| container.id.starts_with(own.as_str()))
        };

        if containers.iter().any(is_own) {
            return Err(BackupError::RunsHangar {
                app: app.to_owned(),
            });
        }

        let mut stopped = Stopped::default();

        for container in containers {
            if !stopped.services.contains(&container.service) {
                stopped.services.push(container.service);
            }

            stopped.ids.push(container.id);
        }

        Ok(stopped)
    }

    /// The containers of `docker compose ps --format json`: one JSON object per line since compose 2.21, an array
    /// before.
    fn parse(stdout: &str) -> Result<Vec<ListedContainer>, serde_json::Error> {
        let trimmed = stdout.trim();

        if trimmed.starts_with('[') {
            return serde_json::from_str(trimmed);
        }

        trimmed
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(serde_json::from_str)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Services;

    #[test]
    fn reads_both_forms_of_compose_ps() {
        let lines = "{\"ID\":\"aaa\",\"Service\":\"web\",\"State\":\"running\"}\n{\"ID\":\"bbb\",\"Service\":\"db\"}\n";
        let array = "[{\"ID\":\"aaa\",\"Service\":\"web\"}]";

        let services = |stdout| {
            Services::parse(stdout)
                .expect("read")
                .into_iter()
                .map(|container| container.service)
                .collect::<Vec<_>>()
        };

        assert_eq!(services(lines), ["web", "db"]);
        assert_eq!(services(array), ["web"]);
        assert!(services("").is_empty());
        assert!(Services::parse("not json").is_err());
    }

    #[test]
    fn tells_the_container_hangar_runs_in_only_by_a_hostname_shaped_like_a_short_id() {
        assert_eq!(
            Services::new(Some("0123456789ab".to_owned()))
                .own_container
                .as_deref(),
            Some("0123456789ab")
        );

        for hostname in ["cafe", "nas.local", "0123456789AB"] {
            assert!(
                Services::new(Some(hostname.to_owned()))
                    .own_container
                    .is_none()
            );
        }
    }
}
