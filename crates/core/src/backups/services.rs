//! The services a backup stops while it reads their files, and starts again after.

use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

use super::BackupError;
use crate::{CommandRunner, Compose, ComposeCommand, ComposeError};

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
    #[cfg(unix)]
    pub(super) fn hostname() -> Option<String> {
        nix::unistd::gethostname()
            .ok()
            .and_then(|name| name.into_string().ok())
    }

    #[cfg(not(unix))]
    pub(super) fn hostname() -> Option<String> {
        None
    }

    /// Stops the services of `app` that have a container running, and gives them, in the order compose listed them:
    /// the ones to start again. None for an app compose runs nothing of.
    ///
    /// # Errors
    ///
    /// [`BackupError::RunsHangar`] when one runs in the container Hangar runs in, before anything is stopped,
    /// [`BackupError::NotStopped`] when compose fails, and [`BackupError::UnreadableServices`] when its list does not
    /// read.
    pub(super) async fn stop<R: CommandRunner>(
        &self,
        compose: &Compose<R>,
        app: &str,
    ) -> Result<Vec<String>, BackupError> {
        let running = self.running(compose, app).await?;

        if running.is_empty() {
            return Ok(running);
        }

        compose
            .capture(app, Self::command("stop", &running))
            .await
            .map_err(|source| BackupError::NotStopped {
                app: app.to_owned(),
                source: Box::new(source),
            })?;

        Ok(running)
    }

    /// Starts again the `services` of `app` a backup stopped.
    ///
    /// # Errors
    ///
    /// The compose error when they do not start.
    pub(super) async fn start<R: CommandRunner>(
        compose: &Compose<R>,
        app: &str,
        services: &[String],
    ) -> Result<(), ComposeError> {
        compose
            .capture(app, Self::command("start", services))
            .await
            .map(drop)
    }

    /// The services of `app` that have a container running, each once.
    async fn running<R: CommandRunner>(
        &self,
        compose: &Compose<R>,
        app: &str,
    ) -> Result<Vec<String>, BackupError> {
        let listed = compose
            .capture(
                app,
                ComposeCommand::Args(
                    ["ps", "--status", "running", "--format", "json"]
                        .map(str::to_owned)
                        .into(),
                ),
            )
            .await;
        let stdout = match listed {
            Ok(stdout) => stdout,
            // Compose can run nothing of an app it cannot take as a project, or that is not installed.
            Err(ComposeError::InvalidProject { .. } | ComposeError::NotInstalled { .. }) => {
                return Ok(Vec::new());
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

        let mut services: Vec<String> = Vec::new();

        for container in containers {
            if !services.contains(&container.service) {
                services.push(container.service);
            }
        }

        Ok(services)
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

    /// `docker compose <name> <services...>`.
    fn command(name: &str, services: &[String]) -> ComposeCommand {
        ComposeCommand::Args(
            std::iter::once(name.to_owned())
                .chain(services.iter().cloned())
                .collect(),
        )
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
