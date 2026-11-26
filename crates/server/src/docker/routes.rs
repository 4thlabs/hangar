//! The routes of the group `Docker`: the projects and a project's detail, read from the cache, the usage of the host,
//! the logs and the stats streamed from the daemon, and what changed in the cache.

use futures::{StreamExt, stream};
use hangar_api::{
    DockerChange, DockerOverview, DockerServer, ErrorCode, LogEvent, ProjectDetail, ProjectSummary,
    StatsFrame,
};
use hangar_core::DockerError;
use quoll::{Error, Events, Response, Result};
use tokio::sync::broadcast::error::RecvError;

use super::DockerState;
use super::views::{Installed, Views};
use crate::App;
use crate::auth::SignedIn;
use crate::failure::Failure;

impl DockerState {
    /// What the store knows of the installed apps.
    async fn installed(&self) -> Result<Installed> {
        let (apps, config) = tokio::join!(self.store.installed_apps(), self.store.config());
        let apps = apps.map_err(|error| Failure::store(ErrorCode::AppsUnreadable, &error))?;
        let config = config.map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;

        Ok(Installed {
            apps,
            categories: config.categories,
        })
    }

    /// The answer of a failed read of the daemon, once logged whole.
    fn unavailable(error: &DockerError) -> Error {
        Failure::logged(ErrorCode::DockerUnavailable, error)
    }

    /// Every installed app, by name.
    async fn projects(&self) -> Result<Vec<ProjectSummary>> {
        let (containers, installed) = tokio::join!(self.containers(), self.installed());
        let containers = containers.map_err(|error| Self::unavailable(&error))?;
        let installed = installed?;

        Ok(containers
            .summaries(installed.ids())
            .into_iter()
            .map(|summary| installed.summary(summary))
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

        Ok(installed.detail(detail))
    }

    /// The followed log of the container `container` of `project`, ended by [`LogEvent::End`] once the container
    /// stops, or by a problem when the daemon fails.
    async fn logs(&self, project: &str, container: &str) -> Result<Events<LogEvent>> {
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

    /// A frame of the usage of the running containers every second, its first sampled before the answer, so that a
    /// daemon that does not answer is a 503 rather than an empty stream.
    async fn stats(&self) -> Result<Events<StatsFrame>> {
        let frames = self
            .docker
            .stats()
            .await
            .map_err(|error| Self::unavailable(&error))?;

        Ok(Events::try_new(frames.map(|frame| {
            frame
                .map(Views::frame)
                .map_err(|error| Self::unavailable(&error))
        })))
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
