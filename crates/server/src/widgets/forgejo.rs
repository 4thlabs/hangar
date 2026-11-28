//! `forgejo-ci`: what Forgejo Actions runs or has queued, and the repositories updated last. Forgejo has no list of
//! the runs of the whole instance, so each repository that runs Actions is asked for its own.

use std::cmp::Reverse;
use std::error::Error as StdError;

use futures::future::BoxFuture;
use futures::{FutureExt, StreamExt, stream};
use hangar_api::{ForgejoCi, ForgejoRepository, ForgejoRun};
use jiff::Timestamp;
use quoll::client;
use serde::Deserialize;

use crate::failure::Failure;
use crate::services::LoadError;
use crate::services::Service;

quoll::api! {
    /// Forgejo's API, under `/api/v1`. Its key, an access token, goes in `Authorization: Bearer ...`, which Forgejo
    /// reads as it reads `token ...`.
    #[server(none)]
    api ForgejoApi = "/api/v1";

    #[auth(Bearer)]
    group Forgejo {
        GET "/repos/search?limit={limit}&page={page}" => search(limit: u32, page: u32) -> Search;
        GET "/users/{owner}/repos?limit={limit}&page={page}"
            => owned(owner: &str, limit: u32, page: u32) -> Vec<Repository>;
        /// Forgejo reads `limit` only beside a `page`.
        GET "/repos/{owner}/{name}/actions/runs?status={status}&limit={limit}&page={page}"
            => runs(owner: &str, name: &str, status: Vec<&str>, limit: u32, page: u32) -> Runs;
    }
}

#[derive(Debug, Deserialize)]
struct Search {
    data: Vec<Repository>,
}

/// A repository, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Repository {
    full_name: String,
    html_url: String,
    /// Bumped by each push and each change of its settings, archiving too.
    updated_at: String,
    archived: bool,
    /// A repository with no commit yet, which runs nothing.
    empty: bool,
    /// Whether its Actions are on: a repository without answers 404 for its runs.
    has_actions: bool,
}

impl Repository {
    /// Whether it may run Actions: on, and neither archived nor empty.
    fn runs_actions(&self) -> bool {
        self.has_actions && !self.archived && !self.empty
    }
}

#[derive(Debug, Deserialize)]
struct Runs {
    workflow_runs: Vec<Run>,
}

/// A run, with the fields the card reads.
#[derive(Debug, Deserialize)]
struct Run {
    id: u64,
    title: String,
    status: String,
    prettyref: String,
    html_url: String,
    created: String,
    /// Go's zero time, `0001-01-01T00:00:00Z`, until it starts.
    started: String,
}

/// Forgejo's default largest page: so the most runs a repository is asked for.
const PAGE_SIZE: u32 = 50;

/// The statuses of a run that has not finished: running, or waiting for a runner or an approval.
const ACTIVE_STATUSES: [&str; 3] = ["running", "waiting", "blocked"];

/// The status of a run that runs, rather than waits.
const RUNNING: &str = "running";

/// How many repositories updated last the card lists.
const RECENT: usize = 3;

/// How many repositories are asked for their runs at once.
const CONCURRENT_CALLS: usize = 8;

/// The client of a placement's service, built once for its address and its key.
#[derive(Debug, Clone)]
pub(super) struct Client(ForgejoApiClient);

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

/// The client of the Forgejo of `service`, with its token.
fn build(service: &Service) -> Result<ForgejoApiClient, LoadError> {
    service.client::<ForgejoApi>("Forgejo", service.key().map(client::bearer))
}

/// The repositories of the Forgejo of `client`, those of `owners` or every one its key sees, and the runs that have
/// not finished in each.
pub(super) async fn load(
    client: &Client,
    owners: Option<&[String]>,
) -> Result<ForgejoCi, LoadError> {
    let forgejo = Calls { client: &client.0 };
    let repositories = match owners {
        None => forgejo.every_repository().await?,
        Some(owners) => {
            let parts = owners
                .iter()
                .map(|owner| part(format!("the repositories of {owner}"), forgejo.owned(owner)))
                .collect();

            settle(parts).await?
        }
    };
    let parts = repositories
        .iter()
        .filter(|repository| repository.runs_actions())
        .map(|repository| {
            part(
                format!("the runs of {}", repository.full_name),
                forgejo.active_runs(repository),
            )
        })
        .collect();
    let active_runs = settle(parts).await?;

    Ok(summary(repositories, active_runs))
}

/// A run that has not finished, and when it was created, which orders the card.
struct Active {
    created: Timestamp,
    run: ForgejoRun,
}

/// The card of `repositories` and of the runs found in them: running first, then newest first, by when they were
/// created, as the Waku version orders them.
fn summary(repositories: Vec<Repository>, mut active_runs: Vec<Active>) -> ForgejoCi {
    active_runs.sort_by_key(|active| (active.run.is_queued, Reverse(active.created)));

    let active_runs = active_runs.into_iter().map(|active| active.run).collect();

    let repository_count = repositories.len() as u64;
    // Archiving bumps `updated_at` too, and an archived repository is not where the work is.
    let mut recent: Vec<_> = repositories
        .into_iter()
        .filter(|repository| !repository.archived)
        .collect();

    recent.sort_by_key(|repository| Reverse(moment(&repository.updated_at)));

    ForgejoCi {
        repository_count,
        active_runs,
        recent_repositories: recent
            .into_iter()
            .take(RECENT)
            .map(|repository| ForgejoRepository {
                updated_at: rfc3339(&repository.updated_at),
                full_name: repository.full_name,
                url: repository.html_url,
            })
            .collect(),
    }
}

/// The time Forgejo writes as `text`; the earliest there is for one it does not write in RFC 3339.
fn moment(text: &str) -> Timestamp {
    text.parse().unwrap_or(Timestamp::MIN)
}

/// The time Forgejo writes as `text`, in RFC 3339 to the millisecond, as the server writes its own; as it is when it
/// does not parse.
fn rfc3339(text: &str) -> String {
    text.parse::<Timestamp>()
        .map_or_else(|_| text.to_owned(), |time| format!("{time:.3}"))
}

/// A part of the card, which gives its name beside what it loaded, for the log.
type Part<'a, T> = BoxFuture<'a, (String, Result<Vec<T>, LoadError>)>;

/// The part `name` of the card, which `loading` loads.
fn part<'a, T>(
    name: String,
    loading: impl Future<Output = Result<Vec<T>, LoadError>> + Send + 'a,
) -> Part<'a, T> {
    async move { (name, loading.await) }.boxed()
}

/// What each of `parts` gives, merged, at most [`CONCURRENT_CALLS`] at once. A part that fails is logged, by its
/// name, and left out, so that one private account or one broken repository does not take the card down; when every
/// one fails, the card does.
async fn settle<T>(parts: Vec<Part<'_, T>>) -> Result<Vec<T>, LoadError> {
    let count = parts.len();
    let settled: Vec<_> = stream::iter(parts)
        .buffer_unordered(CONCURRENT_CALLS)
        .collect()
        .await;
    let mut values = Vec::new();
    let mut failures = 0;
    let mut last_failure = None;

    for (part, loaded) in settled {
        match loaded {
            Ok(loaded) => values.extend(loaded),
            Err(error) => {
                tracing::warn!(
                    part,
                    error = %Failure::chain(&error),
                    "leaving a part of the Forgejo card out"
                );
                failures += 1;
                last_failure = Some(error);
            }
        }
    }

    match last_failure {
        Some(error) if failures == count => Err(LoadError::Call {
            action: "read any part of Forgejo's card".to_owned(),
            source: Box::new(error) as Box<dyn StdError + Send + Sync>,
        }),
        _ => Ok(values),
    }
}

/// The calls of the card.
struct Calls<'a> {
    client: &'a ForgejoApiClient,
}

impl Calls<'_> {
    /// Every repository the key sees, other people's public ones too.
    async fn every_repository(&self) -> Result<Vec<Repository>, LoadError> {
        let mut repositories = Vec::new();

        for page in 1.. {
            let found = self
                .client
                .forgejo()
                .search(PAGE_SIZE, page)
                .await
                .map_err(LoadError::call("search Forgejo's repositories"))?
                .data;
            // A short page is the last: `X-Total-Count` says it too, but a proxy may take it out.
            let is_last = found.len() < PAGE_SIZE as usize;

            repositories.extend(found);

            if is_last {
                break;
            }
        }

        Ok(repositories)
    }

    /// Every repository of the user or organization `owner` that the key sees.
    async fn owned(&self, owner: &str) -> Result<Vec<Repository>, LoadError> {
        let mut repositories = Vec::new();

        for page in 1.. {
            let found = self
                .client
                .forgejo()
                .owned(owner, PAGE_SIZE, page)
                .await
                .map_err(LoadError::call(format!(
                    "list the repositories of {owner} on Forgejo"
                )))?;
            let is_last = found.len() < PAGE_SIZE as usize;

            repositories.extend(found);

            if is_last {
                break;
            }
        }

        Ok(repositories)
    }

    /// The runs of `repository` that have not finished.
    async fn active_runs(&self, repository: &Repository) -> Result<Vec<Active>, LoadError> {
        let Some((owner, name)) = repository.full_name.split_once('/') else {
            return Err(LoadError::refused(format!(
                "Forgejo names a repository {}, with no owner",
                repository.full_name
            )));
        };
        let runs = self
            .client
            .forgejo()
            .runs(owner, name, ACTIVE_STATUSES.to_vec(), PAGE_SIZE, 1)
            .await
            .map_err(LoadError::call(format!(
                "list the runs of {} on Forgejo",
                repository.full_name
            )))?;

        Ok(runs
            .workflow_runs
            .into_iter()
            .map(|run| {
                let started = moment(&run.started);
                // Go's zero time, for a run that has not started, is the year 1.
                let since = if started > Timestamp::UNIX_EPOCH {
                    &run.started
                } else {
                    &run.created
                };

                Active {
                    created: moment(&run.created),
                    run: ForgejoRun {
                        id: run.id,
                        repository: repository.full_name.clone(),
                        since: rfc3339(since),
                        is_queued: run.status != RUNNING,
                        title: run.title,
                        status: run.status,
                        reference: run.prettyref,
                        url: run.html_url,
                    },
                }
            })
            .collect())
    }
}
