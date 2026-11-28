//! Compose: the commands the Apps pages run on a batch of installed apps, on the core's [`Compose::batch`]. A batch
//! runs on its own, whoever reads its output; the server keeps it while it runs and a short while after, so that a page
//! that comes back reads its output again, and tells of each app's end once the Docker cache holds what it changed.

mod kept;
mod routes;
mod views;

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use futures::StreamExt;
use hangar_api::{ComposeAction, DockerChange, ErrorCode, NotificationLevel, NotificationMessage};
use hangar_core::{
    AppOutcome, BatchEvent, Compose, ComposeCommand, ComposeError, DataDir, GlobalEnv, OnFailure,
    Runtime, Secrets, Store,
};

use crate::Settings;
use crate::app_locks::{AppClaim, AppLocks};
use crate::docker::DockerState;
use crate::failure::Failure;
use crate::notifications::{Notification, Notifier};
pub(crate) use kept::KeptBatch;
use views::ComposeViews;

/// What the routes of compose run on: the core's compose, the store, whose `hangar.yml` orders a batch, the Docker
/// state, read again after each app, and the batches kept. Shared: `App` holds it in an `Arc`.
#[derive(Debug)]
pub(crate) struct ComposeState {
    compose: Compose<Runtime>,
    store: Store<Runtime>,
    data_dir: DataDir,
    docker: Arc<DockerState>,
    notifier: Notifier,
    /// The apps each command holds, shared with the store's installs and uninstalls.
    locks: Arc<AppLocks>,
    /// The batches that run, and those that ended less than [`KEPT`](Self::KEPT) ago, by id.
    batches: Mutex<BTreeMap<u64, Arc<KeptBatch>>>,
    /// The id of the next batch.
    next_id: AtomicU64,
}

impl ComposeState {
    /// How long a batch is kept once it ended: a page that lists it as it ends still reads its output.
    const KEPT: Duration = Duration::from_secs(5 * 60);

    /// How many batches are kept at most, those that run aside: each keeps up to a MiB of output.
    const MOST_KEPT: usize = 20;

    /// The compose commands of the server's settings, run by `runtime`; each app's end is told to `notifier` once
    /// `docker` holds what it changed, and a batch holds its apps in `locks`.
    pub(crate) fn new(
        settings: &Settings,
        runtime: Runtime,
        docker: Arc<DockerState>,
        notifier: Notifier,
        locks: Arc<AppLocks>,
    ) -> Arc<Self> {
        Arc::new(Self {
            compose: Compose::new(settings.data_dir.clone(), runtime.clone()),
            store: Store::new(
                settings.store_url.clone(),
                settings.data_dir.clone(),
                runtime,
            ),
            data_dir: settings.data_dir.clone(),
            docker,
            notifier,
            locks,
            batches: Mutex::new(BTreeMap::new()),
            next_id: AtomicU64::new(1),
        })
    }

    /// Starts `action` over `apps`, once each is checked, and keeps the batch: it runs on its own, carrying on after
    /// an app that fails, in the order of `hangar.yml`, `down` in reverse, and holds its apps until it ends.
    ///
    /// # Errors
    ///
    /// A 400 for no app or a name compose does not take, a 404 for an app that is not installed, a 409 for an app
    /// another command holds or while a sync of the store runs, and the error of a `hangar.yml` that cannot be read,
    /// which orders the batch.
    pub(crate) async fn start(
        self: &Arc<Self>,
        action: ComposeAction,
        apps: &[String],
    ) -> quoll::Result<Arc<KeptBatch>> {
        let command = ComposeViews::command(action);

        self.require_installed(apps).await?;

        let claim = self.locks.claim_batch(apps.iter().map(String::as_str))?;
        let config = self
            .store
            .config()
            .await
            .map_err(|error| Failure::store(ErrorCode::ConfigUnreadable, &error))?;
        let secrets = self.secrets().await;
        let batch = self
            .compose
            .batch(command.clone(), apps, &config, OnFailure::CarryOn)
            .await
            .map_err(|error| Self::refused(&error, apps, &command))?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let kept = KeptBatch::new(id, action, batch, secrets);

        tracing::info!(id, command = %command, apps = %kept.apps().join(", "), "a compose batch starts");
        self.keep(&kept);
        // The pages list the batches again, and disable the buttons of its apps.
        self.docker.tell(DockerChange::Containers);
        tokio::spawn(Arc::clone(self).watch(Arc::clone(&kept), claim));

        Ok(kept)
    }

    /// Checks each of `apps`, in the order asked, before anything else: a 400, `docker.invalid_project`, for a name
    /// compose does not take, and a 404, `docker.unknown_project`, for an app that is not installed. A batch then holds
    /// no more apps than are installed, read once whatever their number.
    async fn require_installed(&self, apps: &[String]) -> quoll::Result<()> {
        let installed = self.installed().await?;

        for app in apps {
            let code = if !Compose::<Runtime>::is_project_name(app) {
                ErrorCode::InvalidProject {
                    project: app.clone(),
                }
            } else if !installed.contains(app) {
                ErrorCode::UnknownProject {
                    project: app.clone(),
                }
            } else {
                continue;
            };

            tracing::warn!(app = ?app, code = code.code(), "a compose batch was refused");

            return Err(code.into());
        }

        Ok(())
    }

    /// The apps installed, by the links of `app-installed/`: none before the first.
    async fn installed(&self) -> quoll::Result<HashSet<String>> {
        let unreadable = |error: std::io::Error| Failure::logged(ErrorCode::AppsUnreadable, &error);
        let mut entries = match tokio::fs::read_dir(self.data_dir.installed()).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashSet::new()),
            Err(error) => return Err(unreadable(error)),
        };
        let mut installed = HashSet::new();

        while let Some(entry) = entries.next_entry().await.map_err(unreadable)? {
            // A name that is not UTF-8 is no app's, as an app's id is ASCII.
            if let Ok(name) = entry.file_name().into_string() {
                installed.insert(name);
            }
        }

        Ok(installed)
    }

    /// The values a batch's output may echo, which the page must not see: those of `.env.global`, as it is when the
    /// batch starts, and of the server's environment.
    async fn secrets(&self) -> Secrets {
        let variables = GlobalEnv::new(&self.data_dir).read().await.unwrap_or_else(|error| {
            tracing::warn!(
                error = %Failure::chain(&error),
                "could not read .env.global: the output of a batch is masked of the server's environment alone"
            );

            BTreeMap::new()
        });

        Secrets::with_environment(&variables)
    }

    /// Keeps `kept`, and forgets the oldest batches that ended past the last [`MOST_KEPT`](Self::MOST_KEPT); a batch
    /// that runs is never forgotten, and its apps bound how many run.
    fn keep(&self, kept: &Arc<KeptBatch>) {
        let mut batches = self.batches();

        batches.insert(kept.id(), Arc::clone(kept));

        let ended: Vec<u64> = batches
            .values()
            .filter(|batch| batch.is_recorded())
            .map(|batch| batch.id())
            .collect();
        let excess = batches.len().saturating_sub(Self::MOST_KEPT);

        for id in ended.into_iter().take(excess) {
            batches.remove(&id);
        }
    }

    /// The batch `id`, while it is kept.
    ///
    /// # Errors
    ///
    /// A 404, `compose.unknown_batch`, once it is not.
    pub(crate) fn batch(&self, id: u64) -> quoll::Result<Arc<KeptBatch>> {
        self.batches()
            .get(&id)
            .cloned()
            .ok_or_else(|| ErrorCode::UnknownBatch { batch: id }.into())
    }

    /// The batches kept, by id.
    pub(crate) fn kept(&self) -> Vec<Arc<KeptBatch>> {
        self.batches().values().cloned().collect()
    }

    /// The answer of a batch of `command` over `apps` that the core refused before any app ran.
    fn refused(error: &ComposeError, apps: &[String], command: &ComposeCommand) -> quoll::Error {
        let code = match error {
            ComposeError::EmptyBatch => ErrorCode::NoApps,
            ComposeError::InvalidProject { app } => ErrorCode::InvalidProject {
                project: app.clone(),
            },
            ComposeError::NotInstalled { app } => ErrorCode::UnknownProject {
                project: app.clone(),
            },
            // A fresh data directory's `.env.global`, which compose cannot run without, could not be created.
            ComposeError::Env { .. } => return Failure::logged(ErrorCode::EnvSaveFailed, error),
            // The actions of the page are never attached, and start with their command's name: the server's own bug.
            other => {
                return Failure::logged(
                    ErrorCode::BatchUnchecked {
                        command: command.to_string(),
                    },
                    other,
                );
            }
        };

        tracing::warn!(apps = ?apps, %error, "a compose batch was refused");

        code.into()
    }

    /// Tells of the end of each app of `kept` as it comes, then lets its apps go, held by `claim`, and records its
    /// report; forgets the batch once it has been kept long enough.
    ///
    /// The apps are told in a task of their own, so that a panic there still lets them go and records the report: the
    /// readers of the output wait for it.
    async fn watch(self: Arc<Self>, kept: Arc<KeptBatch>, claim: AppClaim) {
        let this = Arc::clone(&self);
        let told = Arc::clone(&kept);

        if let Err(error) = tokio::spawn(async move { this.tell_each(&told).await }).await {
            tracing::error!(id = kept.id(), %error, "the ends of a compose batch were not all told");
        }

        // Before the report: a page told of the end runs a command on the apps at once.
        drop(claim);
        kept.record().await;
        self.docker.tell(DockerChange::Containers);

        // Let go while it waits: a batch the listing's cap forgets meanwhile frees its output.
        let id = kept.id();

        drop(kept);
        tokio::time::sleep(Self::KEPT).await;
        self.batches().remove(&id);
    }

    /// Tells of the end of each app of `kept`, as the batch's output says it, then of those its reader missed, as the
    /// report says it: the output keeps its last MiB alone.
    async fn tell_each(&self, kept: &KeptBatch) {
        let mut told = HashSet::new();
        let mut output = std::pin::pin!(kept.output());

        while let Some(event) = output.next().await {
            if let BatchEvent::Finished(outcome) = event {
                self.tell(kept, &outcome).await;
                told.insert(outcome.app);
            }
        }

        for outcome in kept.finished().await.apps {
            if !told.contains(&outcome.app) {
                self.tell(kept, &outcome).await;
            }
        }
    }

    /// Notifies how the batch ended on an app, once the Docker cache holds what it changed: the page that reads it
    /// again, told by the notification or by the cache's change, reads the new state. Always, as a command that fails
    /// half-way leaves containers it started.
    async fn tell(&self, kept: &KeptBatch, outcome: &AppOutcome) {
        self.docker.settle().await;

        let project = outcome.app.to_string();
        let action = kept.action();
        let (level, message) = if outcome.status.is_success() {
            let message = NotificationMessage::ComposeSucceeded { project, action };

            (NotificationLevel::Success, message)
        } else {
            let message = NotificationMessage::ComposeFailed { project, action };

            (NotificationLevel::Error, message)
        };

        self.notifier.notify(Notification {
            level,
            message,
            href: Some(format!("/apps/{}", outcome.app)),
            dedupe_key: None,
        });
    }

    /// The batches kept, whatever a panic left them: each insert or removal is written whole.
    fn batches(&self) -> std::sync::MutexGuard<'_, BTreeMap<u64, Arc<KeptBatch>>> {
        self.batches.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;

    use hangar_api::{ComposeAction, NotificationLevel, NotificationMessage};
    use hangar_core::{Docker, Runtime};

    use super::ComposeState;
    use crate::Settings;
    use crate::docker::{DockerChanges, DockerState};
    use crate::notifications::Notifier;

    /// A data directory where `alpha` and `gamma` are installed, `hangar.yml` listing `gamma` first, and the state of
    /// its compose commands, run by a `docker` that fails on `alpha`.
    async fn state(dir: &tempfile::TempDir) -> Arc<ComposeState> {
        let data = dir.path().join("data");
        let bin = dir.path().join("bin");

        for app in ["alpha", "gamma"] {
            let folder = data.join("app-installed").join(app);

            std::fs::create_dir_all(&folder).expect("created");
            std::fs::write(folder.join("compose.yml"), "services: {}\n").expect("written");
        }

        std::fs::create_dir_all(data.join("app-store/config")).expect("created");
        std::fs::write(
            data.join("app-store/config/hangar.yml"),
            "categories:\n  - { name: Apps, color: blue, stacks: [gamma, alpha] }\n",
        )
        .expect("written");
        std::fs::create_dir_all(&bin).expect("created");
        std::fs::write(
            bin.join("docker"),
            "#!/bin/sh\ncase \"$*\" in *\" -p alpha \"*) exit 1;; esac\n",
        )
        .expect("written");
        std::fs::set_permissions(bin.join("docker"), std::fs::Permissions::from_mode(0o755))
            .expect("made executable");

        let data = data.to_str().expect("UTF-8").to_owned();
        let settings = Settings::read(|name| match name {
            "HANGAR_DATA_DIR" => Some(data.clone()),
            "HANGAR_STORE_URL" => Some("https://example.com/store.git".to_owned()),
            "DOMAIN" => Some("example.com".to_owned()),
            "HANGAR_URL" => Some("https://hangar.example.com".to_owned()),
            "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
            _ => None,
        })
        .expect("the settings are valid");
        let path = std::env::var("PATH").unwrap_or_default();
        let runtime = Runtime::new().envs([("PATH", format!("{}:{path}", bin.display()))]);
        // A daemon nobody reads: the settle after each app has nothing to read again.
        let docker = Docker::with_host("tcp://127.0.0.1:9").expect("a client");
        let docker = DockerState::new(&settings, runtime.clone(), docker, DockerChanges::new());

        let notifier = Notifier::load(&settings.data_dir).await;

        ComposeState::new(&settings, runtime, docker, notifier, Arc::default())
    }

    #[tokio::test]
    async fn notifies_the_end_of_each_app_before_the_end_of_its_batch() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let state = state(&dir).await;
        let action = ComposeAction::Up {
            pull: true,
            force_recreate: true,
        };

        let kept = state
            .start(action, &["alpha".to_owned(), "gamma".to_owned()])
            .await
            .expect("started");

        kept.ended().await;

        let succeeded = NotificationMessage::ComposeSucceeded {
            project: "gamma".to_owned(),
            action,
        };
        let failed = NotificationMessage::ComposeFailed {
            project: "alpha".to_owned(),
            action,
        };

        let filed: Vec<_> = state
            .notifier
            .recent()
            .notifications
            .into_iter()
            .map(|filed| (filed.level, filed.message, filed.href))
            .collect();

        // The newest first.
        assert_eq!(
            filed,
            [
                (
                    NotificationLevel::Error,
                    failed,
                    Some("/apps/alpha".to_owned())
                ),
                (
                    NotificationLevel::Success,
                    succeeded,
                    Some("/apps/gamma".to_owned())
                ),
            ]
        );
    }
}
