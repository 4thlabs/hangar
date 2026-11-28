//! `backrest-summary`: Backrest's repositories and how their backups went, from its summary dashboard.

use hangar_api::{BackrestHealth, BackrestRepository, BackrestSummary};
use quoll::client;
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};

use crate::services::LoadError;
use crate::services::Moment;
use crate::services::Service;

quoll::api! {
    /// Backrest's Connect-RPC API, at the root: every call, a read too, is a `POST` of JSON.
    #[server(none)]
    api BackrestApi = "";

    /// A key, when Backrest is given one.
    scheme ApiKey = header "X-API-Key";

    #[auth(ApiKey)]
    group Backrest {
        POST "/v1.Backrest/GetSummaryDashboard" => summary(request: &Empty) -> Summary;
    }
}

/// The empty request of a call that takes no field.
#[derive(Debug, Serialize)]
struct Empty {}

/// The summary, with the fields the card reads: Connect leaves out a field of its default value, an empty list or a 0.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Summary {
    repo_summaries: Vec<RepoSummary>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RepoSummary {
    id: String,
    #[serde(deserialize_with = "Int64::read")]
    backups_success_last30days: u64,
    #[serde(deserialize_with = "Int64::read")]
    bytes_added_last30days: u64,
    #[serde(deserialize_with = "Int64::read")]
    protected_bytes: u64,
    #[serde(deserialize_with = "Int64::read")]
    next_backup_time_ms: u64,
    recent_backups: RecentBackups,
}

/// The backups a repository ran lately, as lists side by side, the last first.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RecentBackups {
    status: Vec<String>,
    #[serde(deserialize_with = "Int64::read_all")]
    timestamp_ms: Vec<u64>,
}

/// An `int64` as Connect writes it in JSON: a string of digits, which a number may stand for too.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Int64 {
    Text(String),
    Number(u64),
}

impl Int64 {
    fn value<E: de::Error>(self) -> Result<u64, E> {
        match self {
            Self::Text(text) => text.parse().map_err(E::custom),
            Self::Number(number) => Ok(number),
        }
    }

    fn read<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        Self::deserialize(deserializer)?.value()
    }

    fn read_all<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u64>, D::Error> {
        Vec::<Self>::deserialize(deserializer)?
            .into_iter()
            .map(Self::value)
            .collect()
    }
}

impl RepoSummary {
    /// What Backrest calls a success, the only status that is healthy.
    const SUCCESS: &str = "STATUS_SUCCESS";

    /// What Backrest writes before each status.
    const STATUS_PREFIX: &str = "STATUS_";

    fn repository(self) -> BackrestRepository {
        let status = self.recent_backups.status.first();
        let health = match status {
            None => BackrestHealth::NeverRun,
            Some(status) if status == Self::SUCCESS => BackrestHealth::Healthy,
            Some(_) => BackrestHealth::Failed,
        };

        BackrestRepository {
            status: status.map(|status| {
                status
                    .strip_prefix(Self::STATUS_PREFIX)
                    .unwrap_or(status)
                    .to_owned()
            }),
            health,
            last_run_at: Self::moment(self.recent_backups.timestamp_ms.first().copied()),
            successes: self.backups_success_last30days,
            bytes_added: self.bytes_added_last30days,
            protected_bytes: self.protected_bytes,
            next_backup_at: Self::moment(Some(self.next_backup_time_ms)),
            id: self.id,
        }
    }

    /// A time in milliseconds, which Backrest writes 0, or leaves out, for never.
    fn moment(milliseconds: Option<u64>) -> Option<String> {
        let milliseconds = milliseconds.filter(|milliseconds| *milliseconds > 0)?;

        Some(Moment::from_milliseconds(
            i64::try_from(milliseconds).unwrap_or(i64::MAX),
        ))
    }
}

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(BackrestApiClient);

impl Client {
    /// The client of the service `service`, with its key.
    ///
    /// # Errors
    ///
    /// When the client cannot be built, or the key cannot be sent.
    pub(super) fn new(service: &Service) -> Result<Self, LoadError> {
        build(service).map(Self)
    }
}

/// The client of the Backrest of `service`, with its key.
fn build(service: &Service) -> Result<BackrestApiClient, LoadError> {
    service.client::<BackrestApi>("Backrest", service.key().map(client::key::<ApiKey>))
}

/// The repositories of the Backrest of `client`.
pub(super) async fn load(client: &Client) -> Result<BackrestSummary, LoadError> {
    let summary = client
        .0
        .backrest()
        .summary(&Empty {})
        .await
        .map_err(LoadError::call("read Backrest's summary"))?;

    Ok(BackrestSummary {
        repositories: summary
            .repo_summaries
            .into_iter()
            .map(RepoSummary::repository)
            .collect(),
    })
}
