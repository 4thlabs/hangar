//! Forgejo: the repositories, and the runs of Forgejo Actions that have not finished. Forgejo has no list of the runs
//! of the whole instance, so each repository that runs Actions is asked for its own.

use std::error::Error as StdError;
use std::sync::Arc;

use futures::future::{BoxFuture, OptionFuture};
use futures::{FutureExt, StreamExt, stream};
use hangar_api::{ForgejoData, ForgejoRead, ForgejoRepository, ForgejoRun};
use jiff::Timestamp;
use quoll::client;
use serde::Deserialize;

use super::cache::Part;
use super::clients::Clients;
use super::error::LoadError;
use super::{Locator, Service};
use crate::failure::Failure;

quoll::api! {
    /// Forgejo's API, under `/api/v1`. Its key, an access token, goes in `Authorization: Bearer ...`, which Forgejo
    /// reads as it reads `token ...`.
    #[server(none)]
    api ForgejoApi = "/api/v1";

    #[auth(Bearer)]
    group Repos {
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
#[derive(Debug, Clone, Deserialize)]
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

    /// The repository as the contract writes it.
    fn public(&self) -> ForgejoRepository {
        ForgejoRepository {
            full_name: self.full_name.clone(),
            url: self.html_url.clone(),
            updated_at: rfc3339(&self.updated_at),
            archived: self.archived,
        }
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

/// How many repositories are asked for their runs at once.
const CONCURRENT_CALLS: usize = 8;

/// The owners a widget covers, `None` for every repository its key sees: what keys its calls.
type Owners = Option<Vec<String>>;

/// Forgejo, as the widgets read it: its clients, and its parts, each kept by its call.
#[derive(Debug)]
pub(super) struct Forgejo {
    clients: Arc<Clients<ForgejoApiClient>>,
    repositories: Part<Owners, Vec<Repository>>,
    /// The runs not finished, by the repositories they are asked of, `owner/name`: a list changed since is another
    /// call, and two declarations whose lists are the same share one.
    runs: Part<Vec<String>, Vec<ForgejoRun>>,
}

impl Forgejo {
    /// No client and no part kept yet.
    pub(super) fn new() -> Self {
        Self {
            clients: Clients::new(Self::client),
            repositories: Part::new("Forgejo repositories"),
            runs: Part::new("Forgejo active runs"),
        }
    }

    /// The parts `read` asks of the Forgejo `locator` finds, for the repositories of `owners`, or every one its key
    /// sees. The runs are asked of the repositories, which they are read for too.
    pub(super) async fn read(
        &self,
        locator: &Locator,
        owners: Option<&[String]>,
        read: ForgejoRead,
    ) -> Result<ForgejoData, Arc<LoadError>> {
        let ForgejoRead { repositories, runs } = read;
        let owners = owners.map(<[String]>::to_vec);

        if !repositories && !runs {
            return Ok(ForgejoData {
                repositories: None,
                runs: None,
            });
        }

        let listed = self.repositories(locator, &owners).await?;
        let runs = OptionFuture::from(runs.then(|| self.runs(locator, &listed))).await;

        Ok(ForgejoData {
            repositories: repositories.then(|| listed.iter().map(Repository::public).collect()),
            runs: runs.transpose()?,
        })
    }

    /// The client of the Forgejo of `service`, with its token.
    fn client(service: &Service) -> Result<ForgejoApiClient, LoadError> {
        service.client::<ForgejoApi>("Forgejo", service.key().map(client::bearer))
    }

    /// The repositories of `owners`, or every one the key sees.
    async fn repositories(
        &self,
        locator: &Locator,
        owners: &Owners,
    ) -> Result<Vec<Repository>, Arc<LoadError>> {
        let call = owners.clone();

        self.repositories
            .get(
                locator,
                &self.clients,
                owners.clone(),
                move |client| async move {
                    let forgejo = Calls { client: &client };

                    match call {
                        None => forgejo.every_repository().await,
                        Some(owners) => {
                            let fetches = owners
                                .iter()
                                .map(|owner| {
                                    fetch(
                                        format!("the repositories of {owner}"),
                                        forgejo.owned(owner),
                                    )
                                })
                                .collect();

                            settle(fetches).await
                        }
                    }
                },
            )
            .await
    }

    /// The runs that have not finished in each of `listed` that runs Actions.
    async fn runs(
        &self,
        locator: &Locator,
        listed: &[Repository],
    ) -> Result<Vec<ForgejoRun>, Arc<LoadError>> {
        let listed: Vec<Repository> = listed
            .iter()
            .filter(|repository| repository.runs_actions())
            .cloned()
            .collect();
        let mut asked: Vec<String> = listed
            .iter()
            .map(|repository| repository.full_name.clone())
            .collect();

        asked.sort();

        self.runs
            .get(locator, &self.clients, asked, move |client| async move {
                let forgejo = Calls { client: &client };
                let fetches = listed
                    .iter()
                    .map(|repository| {
                        fetch(
                            format!("the runs of {}", repository.full_name),
                            forgejo.active_runs(repository),
                        )
                    })
                    .collect();

                settle(fetches).await
            })
            .await
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

/// One call of a fan-out, which gives its name beside what it loaded, for the log.
type Fetch<'a, T> = BoxFuture<'a, (String, Result<Vec<T>, LoadError>)>;

/// The call `name` of a fan-out, which `loading` makes.
fn fetch<'a, T>(
    name: String,
    loading: impl Future<Output = Result<Vec<T>, LoadError>> + Send + 'a,
) -> Fetch<'a, T> {
    async move { (name, loading.await) }.boxed()
}

/// What each of `fetches` gives, merged, at most [`CONCURRENT_CALLS`] at once. A call that fails is logged, by its
/// name, and left out, so that one private account or one broken repository does not take the part down; when every
/// one fails, the part does.
async fn settle<T>(fetches: Vec<Fetch<'_, T>>) -> Result<Vec<T>, LoadError> {
    let count = fetches.len();
    let settled: Vec<_> = stream::iter(fetches)
        .buffer_unordered(CONCURRENT_CALLS)
        .collect()
        .await;
    let mut values = Vec::new();
    let mut failures = 0;
    let mut last_failure = None;

    for (call, loaded) in settled {
        match loaded {
            Ok(loaded) => values.extend(loaded),
            Err(error) => {
                tracing::warn!(
                    call,
                    error = %Failure::chain(&error),
                    "leaving a call of a Forgejo part out"
                );
                failures += 1;
                last_failure = Some(error);
            }
        }
    }

    match last_failure {
        Some(error) if failures == count => Err(LoadError::Call {
            action: "make any call of a Forgejo part".to_owned(),
            source: Box::new(error) as Box<dyn StdError + Send + Sync>,
        }),
        _ => Ok(values),
    }
}

/// The calls of a part.
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
                .repos()
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
                .repos()
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
    async fn active_runs(&self, repository: &Repository) -> Result<Vec<ForgejoRun>, LoadError> {
        let Some((owner, name)) = repository.full_name.split_once('/') else {
            return Err(LoadError::refused(format!(
                "Forgejo names a repository {}, with no owner",
                repository.full_name
            )));
        };
        let runs = self
            .client
            .repos()
            .runs(owner, name, ACTIVE_STATUSES.to_vec(), PAGE_SIZE, 1)
            .await
            .map_err(LoadError::call(format!(
                "list the runs of {} on Forgejo",
                repository.full_name
            )))?;

        Ok(runs
            .workflow_runs
            .into_iter()
            .map(|run| ForgejoRun {
                id: run.id,
                repository: repository.full_name.clone(),
                created_at: rfc3339(&run.created),
                // Go's zero time, for a run that has not started, is the year 1.
                started_at: (moment(&run.started) > Timestamp::UNIX_EPOCH)
                    .then(|| rfc3339(&run.started)),
                title: run.title,
                status: run.status,
                reference: run.prettyref,
                url: run.html_url,
            })
            .collect())
    }
}
