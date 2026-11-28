//! The store's sync: a clone, or a pull once cloned, run apart from the request that starts it, one at a time, its
//! outcome kept for the page to read again and notified.

use std::sync::Arc;

use hangar_api::{
    ErrorCode, ErrorDetail, NotificationLevel, NotificationMessage, StoreSync, SyncOperation,
    SyncState,
};
use hangar_core::StoreError;

use super::StoreState;
use super::command_log::CommandLog;
use crate::app_locks::SyncClaim;
use crate::failure::Failure;
use crate::notifications::Notification;
use crate::timestamp::Timestamp;

impl StoreState {
    /// The page a sync's notification leads to.
    const SYNC_HREF: &str = "/settings";

    /// The last sync since the server started, running or ended.
    pub(crate) fn last_sync(&self) -> Option<StoreSync> {
        self.sync.borrow().clone()
    }

    /// Starts a sync, and answers it running; while one runs, answers that one, and starts none.
    ///
    /// Detached: a clone or a pull is as long as the network makes it, and the request does not wait for it. Its end
    /// is kept, for `GET /store`, and notified. No compose batch runs beside it, as it pulls and links the files a
    /// batch's compose reads.
    ///
    /// # Errors
    ///
    /// A 409, `store.batch_running`, naming the apps compose batches hold.
    pub(crate) async fn start_sync(self: &Arc<Self>) -> Result<StoreSync, ErrorCode> {
        let state = Arc::clone(self);

        self.start_sync_with(
            async move { state.store.install(CommandLog::lines("git", "store")).await },
        )
        .await
    }

    /// Starts a sync that runs `work`, unless one runs or a compose batch does; `work` is dropped unpolled then.
    async fn start_sync_with<W>(self: &Arc<Self>, work: W) -> Result<StoreSync, ErrorCode>
    where
        W: Future<Output = Result<(), StoreError>> + Send + 'static,
    {
        // One start at a time, so that whether the store is cloned is read while no sync runs: once one clone ends,
        // the next start reads an update.
        let _starting = self.starting.lock().await;

        if self.gate.is_syncing()
            && let Some(running) = self.last_sync()
        {
            return Ok(running);
        }

        let claim = self.locks.claim_sync()?;
        let operation = if self.store.is_installed().await {
            SyncOperation::Update
        } else {
            SyncOperation::Install
        };
        let started = StoreSync {
            operation,
            state: SyncState::Running,
            started_at: Timestamp::now(),
            finished_at: None,
            error: None,
        };

        // Marked and published together: no change gets in from now on, and the page reads it running.
        self.gate.begin_sync(|| {
            self.sync.send_replace(Some(started.clone()));
        });
        tokio::spawn(Arc::clone(self).sync(operation, work, claim));

        Ok(started)
    }

    /// Resolves once no sync runs.
    #[cfg(test)]
    pub(crate) async fn sync_ended(&self) -> Option<StoreSync> {
        let mut receiver = self.sync.subscribe();
        let ended = receiver
            .wait_for(|sync| {
                sync.as_ref()
                    .is_none_or(|sync| sync.state != SyncState::Running)
            })
            .await
            .expect("the state holds the sender");

        ended.clone()
    }

    /// Runs `work`, the sync `operation`, once the changes in before it are done, then records its outcome and notifies it;
    /// compose batches run again from then on, which `claim` kept out.
    ///
    /// In a task of its own, so that a panic in it ends the sync as a failure rather than leave it running until the
    /// server restarts, which no other sync could start before.
    async fn sync<W>(self: Arc<Self>, operation: SyncOperation, work: W, claim: SyncClaim)
    where
        W: Future<Output = Result<(), StoreError>> + Send + 'static,
    {
        let state = Arc::clone(&self);
        let run = tokio::spawn(async move {
            state.gate.changes_ended().await;

            work.await
        });
        let failed = match operation {
            SyncOperation::Install => ErrorCode::CloneFailed,
            SyncOperation::Update => ErrorCode::PullFailed,
        };
        let outcome = match run.await {
            Ok(Ok(())) => {
                tracing::info!(?operation, "the store is synced");
                Ok(())
            }
            Ok(Err(error)) => {
                tracing::error!(?operation, error = %Failure::chain(&error), "the store sync failed");
                Err(Self::describe(&error, failed))
            }
            Err(error) => {
                tracing::error!(?operation, %error, "the store sync stopped short");
                Err(ErrorCode::SyncCrashed)
            }
        };

        // Before its end is published: a page told of it may start a batch at once.
        drop(claim);
        self.finish(operation, outcome);
    }

    /// Records the end of the sync `operation`, and notifies it.
    fn finish(&self, operation: SyncOperation, outcome: Result<(), ErrorCode>) {
        let message = match (&outcome, operation) {
            (Ok(()), SyncOperation::Install) => NotificationMessage::StoreInstalled,
            (Ok(()), SyncOperation::Update) => NotificationMessage::StoreUpdated,
            (Err(_), SyncOperation::Install) => NotificationMessage::StoreInstallFailed,
            (Err(_), SyncOperation::Update) => NotificationMessage::StoreUpdateFailed,
        };
        let (state, level, error) = match outcome {
            Ok(()) => (SyncState::Succeeded, NotificationLevel::Success, None),
            Err(code) => (
                SyncState::Failed,
                NotificationLevel::Error,
                Some(ErrorDetail::from(code)),
            ),
        };
        let finished_at = Timestamp::now();

        self.gate.end_sync(|| {
            self.sync.send_modify(|latest| {
                if let Some(sync) = latest {
                    sync.state = state;
                    sync.finished_at = Some(finished_at);
                    sync.error = error;
                }
            });
        });
        // A sync links the apps `hangar.yml` lists, even one that failed past its clone or pull, and may pull another.
        self.installed_changed();
        self.config_changed();
        self.notifier.notify(Notification {
            level,
            message,
            href: Some(Self::SYNC_HREF.to_owned()),
            dedupe_key: None,
        });
    }

    /// Why a sync failed, for the page: for an invalid `hangar.yml`, the field at fault, which the user is to fix;
    /// else `failed`, which sends them to the log. Never git's output, which may hold the URL's credentials.
    fn describe(error: &StoreError, failed: ErrorCode) -> ErrorCode {
        match error {
            StoreError::Config { source, .. } => Failure::config(source),
            StoreError::DataDirNotSet
            | StoreError::NotUtf8 { .. }
            | StoreError::Io { .. }
            | StoreError::Git { .. }
            | StoreError::NotInstalled
            | StoreError::InvalidName { .. }
            | StoreError::InvalidAppId { .. }
            | StoreError::InTheWay { .. }
            | StoreError::InvalidVariable { .. }
            | StoreError::UnwritableValue { .. }
            | StoreError::UnknownApp { .. }
            | StoreError::SharedFile { .. }
            | StoreError::AppExists { .. }
            | StoreError::InvalidPath { .. }
            | StoreError::ThroughFile { .. }
            | StoreError::OutsideApp { .. }
            | StoreError::HiddenFile { .. }
            | StoreError::BrokenSymlink { .. }
            | StoreError::NoSuchFile { .. }
            | StoreError::NotAFile { .. }
            | StoreError::TooLarge { .. }
            | StoreError::Binary { .. }
            | StoreError::NotUtf8Text { .. }
            | StoreError::FileExists { .. }
            | StoreError::FileAppeared { .. }
            | StoreError::Interrupted { .. }
            | StoreError::InvalidFile { .. }
            | StoreError::Rejected { .. }
            | StoreError::Unchecked { .. } => failed,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use hangar_api::{
        ErrorCode, ErrorDetail, NotificationLevel, NotificationMessage, SyncOperation, SyncState,
    };
    use hangar_core::{Runtime, StoreError};

    use crate::Settings;
    use crate::notifications::Notifier;
    use crate::store::StoreState;

    /// A data directory, and a bare repository holding a store of one app, `alpha`, that `hangar.yml` lists.
    struct Fixture {
        dir: tempfile::TempDir,
        remote: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("a temporary directory");
            let work = dir.path().join("work");
            let remote = dir.path().join("remote.git");

            std::fs::create_dir_all(work.join("config")).expect("created");
            std::fs::create_dir_all(work.join("store/alpha")).expect("created");
            std::fs::write(
                work.join("config/hangar.yml"),
                "categories:\n  - { name: Apps, color: blue, stacks: [alpha] }\n",
            )
            .expect("written");
            std::fs::write(
                work.join("store/alpha/compose.yml"),
                "services:\n  alpha:\n    image: alpha:${ALPHA_TAG}\n",
            )
            .expect("written");
            Self::git(&work, &["init", "--quiet", "--initial-branch=main"]);
            Self::git(&work, &["add", "."]);
            Self::git(&work, &["commit", "--quiet", "--message", "the store"]);
            Self::git(
                dir.path(),
                &["clone", "--quiet", "--bare", "work", "remote.git"],
            );

            Self { dir, remote }
        }

        /// Runs git in `dir`, as a user of its own.
        fn git(dir: &Path, args: &[&str]) {
            let status = Command::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
                .args(args)
                .current_dir(dir)
                .status()
                .expect("git runs");

            assert!(status.success(), "git {args:?}");
        }

        fn data(&self) -> PathBuf {
            self.dir.path().join("data")
        }

        /// The store of the data directory, cloned from `url`, its commands run by `runtime`.
        async fn state(&self, url: &str, runtime: Runtime) -> std::sync::Arc<StoreState> {
            let data = self.data().to_str().expect("UTF-8").to_owned();
            let url = url.to_owned();
            let settings = Settings::read(|name| match name {
                "HANGAR_DATA_DIR" => Some(data.clone()),
                "HANGAR_STORE_URL" => Some(url.clone()),
                "DOMAIN" => Some("example.com".to_owned()),
                "HANGAR_URL" => Some("https://hangar.example.com".to_owned()),
                "HANGAR_SECRET" => Some("0123456789abcdef0123456789abcdef".to_owned()),
                _ => None,
            })
            .expect("the settings are valid");

            StoreState::new(
                &settings,
                runtime,
                crate::docker::DockerChanges::new(),
                Notifier::load(&settings.data_dir).await,
                std::sync::Arc::default(),
            )
        }
    }

    #[tokio::test]
    async fn clones_the_store_then_pulls_it_each_notified() {
        let fixture = Fixture::new();
        let state = fixture
            .state(fixture.remote.to_str().expect("UTF-8"), Runtime::new())
            .await;

        let started = state.start_sync().await.expect("no batch runs");

        assert_eq!(started.operation, SyncOperation::Install);
        assert_eq!(started.state, SyncState::Running);

        let installed = state.sync_ended().await.expect("a sync");

        assert_eq!(installed.state, SyncState::Succeeded, "{installed:?}");
        assert!(installed.finished_at.is_some());
        assert!(
            fixture.data().join("app-installed/alpha").is_symlink(),
            "the apps of hangar.yml are linked"
        );
        assert!(
            std::fs::read_to_string(fixture.data().join(".env.global"))
                .expect("seeded")
                .contains("ALPHA_TAG="),
            "the variables of the installed apps are seeded"
        );

        assert_eq!(
            state.start_sync().await.expect("no batch runs").operation,
            SyncOperation::Update
        );
        assert_eq!(
            state.sync_ended().await.expect("a sync").state,
            SyncState::Succeeded
        );
        assert_eq!(
            state
                .notifier
                .recent()
                .notifications
                .into_iter()
                .map(|filed| (filed.level, filed.message, filed.href))
                .collect::<Vec<_>>(),
            [
                (
                    NotificationLevel::Success,
                    NotificationMessage::StoreUpdated,
                    Some("/settings".to_owned())
                ),
                (
                    NotificationLevel::Success,
                    NotificationMessage::StoreInstalled,
                    Some("/settings".to_owned())
                )
            ]
        );
    }

    #[tokio::test]
    async fn a_failed_clone_is_kept_and_notified_without_git_s_output() {
        let fixture = Fixture::new();
        let missing = fixture.dir.path().join("secret-token@nowhere.git");
        let state = fixture
            .state(missing.to_str().expect("UTF-8"), Runtime::new())
            .await;

        state.start_sync().await.expect("no batch runs");

        let failed = state.sync_ended().await.expect("a sync");

        assert_eq!(failed.state, SyncState::Failed);
        assert_eq!(
            failed.error,
            Some(ErrorDetail {
                code: ErrorCode::CloneFailed,
                message: "the store could not be cloned. See the server's log.".to_owned(),
            })
        );
        assert_eq!(
            state.notifier.recent().notifications[0].message,
            NotificationMessage::StoreInstallFailed
        );
    }

    #[tokio::test]
    async fn a_second_sync_while_one_runs_answers_the_one_running() {
        let fixture = Fixture::new();
        let bin = fixture.dir.path().join("bin");
        let log = fixture.dir.path().join("git.log");
        let release = fixture.dir.path().join("release");

        // A git that logs its call, then waits for the test to let it end; its child's wait, not the test's.
        std::fs::create_dir(&bin).expect("created");
        std::fs::write(
            bin.join("git"),
            format!(
                "#!/bin/sh\necho \"$*\" >> {log}\nwhile [ ! -e {release} ]; do sleep 0.01; done\n",
                log = log.display(),
                release = release.display()
            ),
        )
        .expect("written");
        std::fs::set_permissions(
            bin.join("git"),
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .expect("made executable");

        let path = std::env::var("PATH").unwrap_or_default();
        let runtime = Runtime::new().envs([("PATH", format!("{}:{path}", bin.display()))]);
        let state = fixture
            .state("https://example.com/store.git", runtime)
            .await;

        let first = state.start_sync().await.expect("no batch runs");
        let second = state.start_sync().await.expect("no batch runs");

        assert_eq!(second, first, "the sync running is answered");

        std::fs::write(&release, "").expect("written");

        let ended = state.sync_ended().await.expect("a sync");

        assert_eq!(ended.started_at, first.started_at);
        assert_eq!(
            std::fs::read_to_string(&log)
                .expect("git ran")
                .lines()
                .count(),
            1,
            "git ran once"
        );
        assert_eq!(
            state.notifier.recent().notifications.len(),
            1,
            "one notification"
        );
    }

    /// A sync whose work panics, as a store whose code has a bug would.
    async fn panicking() -> Result<(), StoreError> {
        panic!("the store panicked")
    }

    #[tokio::test]
    async fn a_sync_that_panics_fails_and_another_can_start() {
        let fixture = Fixture::new();
        let state = fixture
            .state(fixture.remote.to_str().expect("UTF-8"), Runtime::new())
            .await;

        state
            .start_sync_with(panicking())
            .await
            .expect("no batch runs");

        let crashed = state.sync_ended().await.expect("a sync");

        assert_eq!(crashed.state, SyncState::Failed);
        assert_eq!(
            crashed.error.map(|error| error.code),
            Some(ErrorCode::SyncCrashed)
        );
        assert_eq!(
            state.notifier.recent().notifications[0].message,
            NotificationMessage::StoreInstallFailed
        );

        assert_eq!(
            state.start_sync().await.expect("no batch runs").state,
            SyncState::Running,
            "a sync starts again"
        );
        assert_eq!(
            state.sync_ended().await.expect("a sync").state,
            SyncState::Succeeded
        );
    }

    #[tokio::test]
    async fn a_change_of_the_store_is_refused_while_a_sync_runs() {
        let fixture = Fixture::new();
        let state = fixture
            .state(fixture.remote.to_str().expect("UTF-8"), Runtime::new())
            .await;
        let (release, released) = tokio::sync::oneshot::channel::<()>();

        state
            .start_sync_with(async move {
                released.await.expect("the test lets the sync end");
                Ok(())
            })
            .await
            .expect("no batch runs");

        let refused = state.change().await.expect_err("a sync runs");

        assert_eq!(refused.status(), Some(http::StatusCode::CONFLICT));

        release.send(()).expect("the sync waits");
        state.sync_ended().await;

        assert!(state.change().await.is_ok(), "the sync has ended");
    }
}
