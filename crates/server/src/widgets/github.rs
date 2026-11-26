//! `github-releases`: the latest release of each repository, from GitHub's public API, each kept on its own so that
//! every placement shares them and the 60 calls an hour GitHub gives without a token go a long way.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use futures::future;
use hangar_api::{GithubRelease, GithubReleases};
use reqwest_middleware::ClientWithMiddleware;
use serde::Deserialize;

use super::cache::{Kept, Policy};
use super::error::LoadError;
use crate::failure::Failure;
use crate::{Secret, Settings};

/// The version of GitHub's REST API the contract follows.
const VERSION: &str = "2022-11-28";

quoll::api! {
    /// GitHub's REST API. Its token, when there is one, goes in `Authorization: Bearer ...`.
    #[server(none)]
    #[header("Accept" = "application/vnd.github+json")]
    #[header("X-GitHub-Api-Version" = VERSION)]
    #[error(GithubMessage)]
    api GithubApi = "";

    group Releases {
        GET "/repos/{owner}/{repo}/releases/latest"
            => latest(owner: &str, repo: &str, header("Authorization") token: Option<&str>) -> Release;
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

/// GitHub, as the widgets call it, and the releases they read, kept per repository.
#[derive(Debug, Clone)]
pub(super) struct Github {
    url: String,
    token: Option<Secret>,
    releases: Arc<Kept<GithubRelease>>,
}

impl Github {
    /// A release is served half an hour before GitHub is asked again, and a day more while GitHub fails, as when its
    /// limit is reached: past that, the card leaves it out rather than show a tag nobody can tell is old.
    const POLICY: Policy = Policy {
        fresh: Duration::from_secs(30 * 60),
        stale: Duration::from_secs(24 * 60 * 60),
    };

    /// GitHub at the URL of `settings`, with their token.
    pub(super) fn new(settings: &Settings) -> Self {
        Self {
            url: settings.github_api_url.clone(),
            token: settings.github_token.clone(),
            releases: Kept::new("GitHub release"),
        }
    }

    /// The latest release of each of `repositories`, newest first. A repository with none, renamed, or private is
    /// logged and left out, so that one bad entry does not take the card down.
    pub(super) async fn latest_releases(
        &self,
        http: &ClientWithMiddleware,
        repositories: &[String],
    ) -> Result<GithubReleases, LoadError> {
        let client = GithubApi::client_with(http.clone(), &self.url)
            .map_err(LoadError::call("reach GitHub"))?;
        let releases = future::join_all(
            repositories
                .iter()
                .map(|repository| self.latest(&client, repository)),
        )
        .await;
        let mut found: Vec<_> = repositories
            .iter()
            .zip(releases)
            .filter_map(|(repository, release)| match release {
                Ok(release) => Some((*release).clone()),
                Err(error) => {
                    tracing::warn!(
                        repository,
                        error = %Failure::chain(&*error),
                        "leaving a repository out of the GitHub card"
                    );

                    None
                }
            })
            .collect();

        // RFC 3339 in UTC, as GitHub writes its times, sorts as text.
        found.sort_by(|first, second| second.published_at.cmp(&first.published_at));

        Ok(GithubReleases { releases: found })
    }

    /// The latest release of `repository`, `owner/repo`, kept.
    async fn latest(
        &self,
        client: &GithubApiClient,
        repository: &str,
    ) -> Result<Arc<GithubRelease>, Arc<LoadError>> {
        let client = client.clone();
        let token = self
            .token
            .as_ref()
            .map(|token| format!("Bearer {}", token.expose()));
        let owned = repository.to_owned();

        self.releases
            .get(repository, Self::POLICY, move || async move {
                let (owner, repo) = owned.split_once('/').ok_or_else(|| {
                    LoadError::refused(format!("{owned} is not a repository, owner/repo"))
                })?;
                let release = client
                    .releases()
                    .latest(owner, repo, token.as_deref())
                    .await
                    .map_err(LoadError::call(format!(
                        "read the latest release of {owned} on GitHub"
                    )))?;

                Ok(GithubRelease {
                    repository: owned.clone(),
                    tag: release.tag_name,
                    url: release.html_url,
                    published_at: release.published_at,
                })
            })
            .await
    }
}
