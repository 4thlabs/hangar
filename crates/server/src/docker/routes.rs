//! The routes of the group `Docker`: the projects and a project's detail, read from the cache, the usage of the host,
//! the logs and the stats streamed from the daemon, and what changed in the cache.

use std::collections::HashSet;
use std::error::Error as StdError;
use std::sync::Arc;

use futures::{StreamExt, stream};
use hangar_api::{
    DockerChange, DockerOverview, DockerServer, ErrorCode, LogEvent, ProjectDetail, ProjectSummary,
    StatsFrame,
};
use hangar_core::DockerError;
use quoll::{Error, Events, Response, Result};
use tokio::sync::broadcast::error::RecvError;

use super::DockerState;
use super::stats::InstalledStats;
use super::views::{Installed, Views};
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl DockerState {
    /// What the store knows of the installed apps, from one read of `hangar.yml`.
    async fn installed(&self) -> Result<Installed> {
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;
        let mut apps = self
            .store
            .apps_with(&config)
            .await
            .map_err(|error| Failure::store(ErrorCode::AppsUnreadable, &error))?;

        apps.retain(|app| app.installed);

        Ok(Installed {
            apps,
            categories: config.categories,
        })
    }

    /// The 404 of `project` when it is not an installed app.
    async fn require_installed(&self, project: &str) -> Result<()> {
        if self.installed().await?.ids().any(|id| id == project) {
            return Ok(());
        }

        Err(ErrorCode::UnknownProject {
            project: project.to_owned(),
        }
        .into())
    }

    /// The ids of the containers of the installed apps, as the cache keeps them.
    pub(super) async fn installed_containers(&self) -> Result<HashSet<String>> {
        let (containers, installed) = tokio::join!(self.containers(), self.installed());
        let containers = containers.map_err(|error| Self::unavailable(&error))?;
        let installed = installed?;
        let projects: HashSet<&str> = installed.ids().collect();

        Ok(containers
            .as_slice()
            .iter()
            .filter(|container| projects.contains(container.project.as_str()))
            .map(|container| container.id.clone())
            .collect())
    }

    /// The answer of a failed read of the daemon, once logged whole.
    pub(super) fn unavailable(error: &dyn StdError) -> Error {
        Failure::logged(ErrorCode::DockerUnavailable, error)
    }

    /// Every installed app, by name.
    async fn projects(&self) -> Result<Vec<ProjectSummary>> {
        let (containers, installed) = tokio::join!(self.containers(), self.installed());
        let containers = containers.map_err(|error| Self::unavailable(&error))?;
        let installed = installed?;
        let outdated = self.outdated(&containers, installed.ids()).await;

        Ok(containers
            .summaries(installed.ids())
            .into_iter()
            .map(|summary| installed.summary(summary, &outdated))
            .collect())
    }

    /// The installed app `project`, with its services.
    async fn project(&self, project: &str) -> Result<ProjectDetail> {
        let (containers, installed) = tokio::join!(self.containers(), self.installed());
        let containers = containers.map_err(|error| Self::unavailable(&error))?;
        let installed = installed?;
        let detail = containers
            .detail(project, installed.ids())
            .map_err(|error| match error {
                DockerError::NotFound { .. } => ErrorCode::UnknownProject {
                    project: project.to_owned(),
                }
                .into(),
                other => Self::unavailable(&other),
            })?;
        let outdated = self.outdated(&containers, installed.ids()).await;

        Ok(installed.detail(detail, &outdated))
    }

    /// The followed log of the container `container` of the installed app `project`, ended by [`LogEvent::End`] once
    /// the container stops, or by a problem when the daemon fails. The app is checked first: another compose project
    /// of the host is none of Hangar's.
    async fn logs(&self, project: &str, container: &str) -> Result<Events<LogEvent>> {
        self.require_installed(project).await?;

        let lines = self
            .docker
            .logs(project, container)
            .await
            .map_err(|error| match error {
                DockerError::NotFound { .. } => ErrorCode::UnknownContainer {
                    project: project.to_owned(),
                    container: container.to_owned(),
                }
                .into(),
                other => Self::unavailable(&other),
            })?;
        let events = lines
            .map(|line| {
                line.map(|line| LogEvent::Line { line })
                    .map_err(|error| Self::unavailable(&error))
            })
            .chain(stream::once(async { Ok(LogEvent::End) }));

        Ok(Events::try_new(events))
    }

    /// A frame of the usage of the running containers of the installed apps every second, its first sampled before
    /// the answer, so that a daemon that does not answer is a 503 rather than an empty stream. The daemon samples every
    /// compose project of the host: the others are none of the page's, as for the logs.
    async fn stats(self: &Arc<Self>) -> Result<Events<StatsFrame>> {
        let frames = self
            .docker
            .stats()
            .await
            .map_err(|error| Self::unavailable(&error))?;

        Ok(Events::try_new(InstalledStats::follow(self, frames).await?))
    }

    /// What changes in the cache from now on. A page that falls too far behind reads everything again.
    fn changes(&self) -> Events<DockerChange> {
        let changes = stream::unfold(self.subscribe(), |mut changes| async move {
            match changes.recv().await {
                Ok(change) => Some((vec![change], changes)),
                Err(RecvError::Lagged(_)) => Some((
                    vec![DockerChange::Containers, DockerChange::Overview],
                    changes,
                )),
                Err(RecvError::Closed) => None,
            }
        })
        .flat_map(stream::iter);

        Events::new(changes)
    }
}

impl DockerServer for App {
    async fn projects(&self, _: &SignedIn) -> Result<Response<Vec<ProjectSummary>>> {
        Ok(Response::new(self.docker.projects().await?))
    }

    async fn project(&self, _: &SignedIn, project: String) -> Result<Response<ProjectDetail>> {
        Ok(Response::new(self.docker.project(&project).await?))
    }

    async fn logs(
        &self,
        _: &SignedIn,
        project: String,
        container: String,
    ) -> Result<Response<Events<LogEvent>>> {
        Ok(Response::new(self.docker.logs(&project, &container).await?))
    }

    async fn stats(&self, _: &SignedIn) -> Result<Response<Events<StatsFrame>>> {
        Ok(Response::new(self.docker.stats().await?))
    }

    async fn overview(&self, _: &SignedIn) -> Result<Response<DockerOverview>> {
        let overview = self
            .docker
            .overview()
            .await
            .map_err(|error| DockerState::unavailable(&error))?;

        Ok(Response::new(Views::overview(&overview)))
    }

    async fn changes(&self, _: &SignedIn) -> Result<Response<Events<DockerChange>>> {
        Ok(Response::new(self.docker.changes()))
    }
}
