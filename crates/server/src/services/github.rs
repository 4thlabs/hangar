//! GitHub's public API: the latest release of each repository of a widget, each kept on its own, so that every
//! placement shares them. GitHub gives 60 calls an hour without a token: each repository's release is asked again once
//! a `ttl` passes, 30 minutes by default, and a longer one asks less often.

use std::fmt;
use std::sync::Arc;

use futures::future::{self, OptionFuture};
use hangar_api::{GithubData, GithubRead, GithubRelease};
use http::StatusCode;
use quoll::client;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, Service};
use crate::failure::Failure;

/// The version of GitHub's REST API the contract follows.
const VERSION: &str = "2022-11-28";

quoll::api! {
    /// GitHub's REST API. Its token, when there is one, goes in `Authorization: Bearer ...`.
    #[server(none)]
    #[header("Accept" = "application/vnd.github+json")]
    #[header("X-GitHub-Api-Version" = VERSION)]
    #[error(GithubMessage)]
    api GithubApi = "";

    #[auth(Bearer)]
    group Releases {
        GET "/repos/{owner}/{repo}/releases/latest" => latest(owner: &str, repo: &str) -> Release;
    }
}

/// What GitHub answers on an error.
#[derive(Debug, Deserialize)]
struct GithubMessage {
    message: String,
}

impl fmt::Display for GithubMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// A release, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    published_at: String,
}

/// GitHub, as the widgets read it: its client, and the latest release of each repository, kept by repository.
#[derive(Debug)]
pub(super) struct Github {
    clients: Arc<Clients<GithubApiClient>>,
    /// The latest release of each repository, `None` for one GitHub shows none of, kept as any answer is.
    release: Part<String, Option<GithubRelease>>,
}

impl Github {
    /// No client and no release kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            release: Part::new("GitHub release"),
        }
    }

    /// The parts `read` asks of GitHub, for `repositories`.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        repositories: &[String],
        read: GithubRead,
    ) -> Result<GithubData, Arc<LoadError>> {
        let GithubRead { releases } = read;
        let releases =
            OptionFuture::from(releases.then(|| self.releases(locator, repositories))).await;

        Ok(GithubData { releases })
    }

    /// The client of GitHub at the address of `service`, with its token when there is one.
    fn client(service: &Service) -> Result<GithubApiClient, LoadError> {
        service.client::<GithubApi>("GitHub", service.key().map(client::bearer))
    }

    /// The latest release of each of `repositories`, in their order. A repository with none, renamed, or private is
    /// left out, as one whose call failed, logged, so that one bad entry does not take the card down.
    async fn releases(&self, locator: &Locator, repositories: &[String]) -> Vec<GithubRelease> {
        let releases = future::join_all(
            repositories
                .iter()
                .map(|repository| self.latest(locator, repository)),
        )
        .await;

        repositories
            .iter()
            .zip(releases)
            .filter_map(|(repository, release)| match release {
                Ok(release) => release,
                Err(error) => {
                    tracing::warn!(
                        repository,
                        error = %Failure::chain(&*error),
                        "leaving a repository out of GitHub's releases"
                    );

                    None
                }
            })
            .collect()
    }

    /// The latest release of `repository`, `owner/repo`; `None` when GitHub shows none, as for a repository with no
    /// release, renamed or private, which is kept as a release is: asked again once the `ttl` passes, not at each read.
    async fn latest(
        &self,
        locator: &Locator,
        repository: &str,
    ) -> Result<Option<GithubRelease>, Arc<LoadError>> {
        let owned = repository.to_owned();

        self.release
            .get(
                locator,
                &self.clients,
                owned.clone(),
                move |client| async move {
                    let (owner, repo) = owned.split_once('/').ok_or_else(|| {
                        LoadError::refused(format!("{owned} is not a repository, owner/repo"))
                    })?;
                    let release = match client.releases().latest(owner, repo).await {
                        Ok(release) => release,
                        Err(error) if error.status() == Some(StatusCode::NOT_FOUND) => {
                            tracing::warn!(
                                repository = owned,
                                "GitHub shows no release of a repository"
                            );

                            return Ok(None);
                        }
                        Err(error) => {
                            return Err(LoadError::call(format!(
                                "read the latest release of {owned} on GitHub"
                            ))(error));
                        }
                    };

                    Ok(Some(GithubRelease {
                        repository: owned.clone(),
                        tag: release.tag_name,
                        url: release.html_url,
                        published_at: release.published_at,
                    }))
                },
            )
            .await
    }
}
