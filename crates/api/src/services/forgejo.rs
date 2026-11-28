//! Forgejo's parts: the repositories, and the runs of Forgejo Actions that have not finished.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What a card reads of Forgejo, in one call: each part asked is in the answer, the others are `null`. Both cover the
/// widget's `owners`, or every repository its key sees.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ForgejoRead {
    /// The repositories.
    pub repositories: bool,
    /// The runs that have not finished, in every repository that runs Actions.
    pub runs: bool,
}

/// Forgejo's parts, those the read asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoData {
    /// The repositories, when the read asked.
    pub repositories: Option<Vec<ForgejoRepository>>,
    /// The runs that have not finished, when the read asked.
    pub runs: Option<Vec<ForgejoRun>>,
}

/// A repository of Forgejo's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoRepository {
    /// `owner/name`.
    pub full_name: String,
    /// Its page.
    pub url: String,
    /// When it was pushed to or changed last, archiving too, in RFC 3339.
    pub updated_at: String,
    /// Whether it is archived.
    pub archived: bool,
}

/// A run of Forgejo Actions that has not finished.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgejoRun {
    /// Its id.
    pub id: u64,
    /// The repository it runs in, `owner/name`.
    pub repository: String,
    /// The title of the commit or pull request it runs for.
    pub title: String,
    /// `running`, `waiting` or `blocked`.
    pub status: String,
    /// The branch, tag or pull request it runs on, as `main` or `#2`.
    pub reference: String,
    /// Its page.
    pub url: String,
    /// When it was queued, in RFC 3339.
    pub created_at: String,
    /// When it started, in RFC 3339; `None` until it does.
    pub started_at: Option<String>,
}
