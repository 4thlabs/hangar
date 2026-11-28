//! GitHub's parts: the latest release of each repository of the widget.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of GitHub, in one call: each part asked is in the answer, the others are `null`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct GithubRead {
    /// The latest release of each repository of the widget.
    pub releases: bool,
}

/// GitHub's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubData {
    /// The releases, in the order `hangar.yml` lists the repositories: a repository with none, renamed, or private is
    /// left out. When the read asked.
    pub releases: Option<Vec<GithubRelease>>,
}

/// A release of a GitHub repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubRelease {
    /// The repository, `owner/repo`, as `hangar.yml` names it.
    pub repository: String,
    /// The release's tag, as `v1.2.3`.
    pub tag: String,
    /// The release's page.
    pub url: String,
    /// When it was published, in RFC 3339.
    pub published_at: String,
}
